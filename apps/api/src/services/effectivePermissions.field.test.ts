import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Permission, TelephonyAgentPermission, User } from '@prisma/client';

vi.mock('@dct-crm/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    permission: {
      findUnique: vi.fn(),
    },
    telephonyAgentPermission: {
      findUnique: vi.fn(),
    },
    profileFieldPermission: {
      findMany: vi.fn(),
    },
    userProfilePermission: {
      findMany: vi.fn(),
    },
    profileObjectPermission: {
      findMany: vi.fn(),
    },
    permissionSet: {
      findMany: vi.fn(),
    },
    userPermissionAssignment: {
      findMany: vi.fn(),
    },
    userRole: {
      findMany: vi.fn(),
    },
    fieldDefinition: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@dct-crm/db';
import { EffectivePermissionService } from './effectivePermissions';
import { getUserFieldPermissions } from './metadata';
import { reconcileObjectPermissionsForPermissionIds, reconcilePermissionIdsForObjectPermissions } from '../routes/profileSecurity';

describe('effective field permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const telephonyPermission: Permission = {
      id: 'perm-telephony-call',
      name: 'TELEPHONY_CALL',
      label: 'Click to call',
      module: 'TELEPHONY',
      action: 'CALL',
      description: 'Place an outbound click-to-call from a lead',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(prisma.permission.findUnique).mockResolvedValue(telephonyPermission);
  });

  it('merges profile and permission set field permissions', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      profileId: 'profile-1',
      tenantId: 'tenant-1',
      isActive: true,
      isSuperAdmin: false,
    } as any);

    vi.mocked(prisma.profileFieldPermission.findMany).mockResolvedValue([
      {
        field: { id: 'field-1', name: 'Name' },
        canRead: true,
        canEdit: false,
      },
    ] as any);

    vi.mocked(prisma.userPermissionAssignment.findMany).mockResolvedValue([
      {
        permissionSet: {
          name: 'Sales Extra',
          fieldPermissions: [
            {
              field: { id: 'field-1', name: 'Name' },
              canRead: true,
              canEdit: true,
            },
          ],
        },
      },
    ] as any);

    vi.mocked(prisma.userRole.findMany).mockResolvedValue([] as any);

    const result = await EffectivePermissionService.getEffectiveFieldPermissions('user-1', 'object-1');

    expect(result).toEqual([
      expect.objectContaining({
        fieldId: 'field-1',
        fieldName: 'Name',
        canRead: true,
        canEdit: true,
        source: 'PERMISSION_SET',
        sourceName: 'Sales Extra',
      }),
    ]);
  });

  it('returns the merged field permissions through the metadata helper', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', isSuperAdmin: false } as any);

    vi.spyOn(EffectivePermissionService, 'getEffectiveFieldPermissions').mockResolvedValue([
      {
        fieldId: 'field-1',
        fieldName: 'Name',
        canRead: true,
        canEdit: true,
        source: 'PERMISSION_SET',
        sourceName: 'Sales Extra',
      },
    ] as any);

    const result = await getUserFieldPermissions('tenant-1', 'user-1', 'object-1');

    expect(result).toEqual([
      { fieldId: 'field-1', fieldName: 'Name', canRead: true, canEdit: true },
    ]);
  });

  it('lets a tenant-scoped agent override deny a profile-inherited telephony grant', async () => {
    const user: User = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      firstName: 'Test',
      lastName: 'Agent',
      phone: null,
      avatar: null,
      isActive: true,
      isSuperAdmin: false,
      profileId: 'profile-1',
      lastLoginAt: null,
      lastSeenAt: null,
      lastLogoutAt: null,
      isLoggedIn: false,
      passwordResetToken: null,
      passwordResetExpires: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      roleId: null,
    };
    const override: TelephonyAgentPermission = {
      id: 'override-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      canUse: false,
      updatedById: 'admin-1',
      updatedAt: new Date(),
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
    vi.mocked(prisma.telephonyAgentPermission.findUnique).mockResolvedValue(override);
    const effectivePermissions = vi.spyOn(EffectivePermissionService, 'getEffectivePermissions').mockResolvedValue([
      { name: 'TELEPHONY_CALL', module: 'TELEPHONY', action: 'CALL', source: 'PROFILE', sourceName: 'Sales' },
    ]);

    await expect(EffectivePermissionService.hasPermission('user-1', 'TELEPHONY_CALL')).resolves.toBe(false);
    effectivePermissions.mockRestore();
    expect(prisma.telephonyAgentPermission.findUnique).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-1', userId: 'user-1' } },
      select: { canUse: true },
    });
  });

  it('treats a missing telephony permission definition as not granted and warns once', async () => {
    vi.mocked(prisma.permission.findUnique).mockResolvedValue(null);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(EffectivePermissionService.hasPermission('user-1', 'TELEPHONY_CALL')).resolves.toBe(false);
    await expect(EffectivePermissionService.hasPermission('user-2', 'TELEPHONY_CALL')).resolves.toBe(false);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('public."Permission"."name"'));
    warning.mockRestore();
  });

  it('invalidates cached permission results after a user grant changes', async () => {
    const owner = {};
    const calculate = vi.spyOn(EffectivePermissionService, 'getEffectivePermissions').mockResolvedValue([]);

    await EffectivePermissionService.getEffectivePermissionsCached(owner, 'user-1');
    await EffectivePermissionService.getEffectivePermissionsCached(owner, 'user-1');
    expect(calculate).toHaveBeenCalledTimes(1);

    EffectivePermissionService.invalidateUserPermissionsCache(['user-1']);
    await EffectivePermissionService.getEffectivePermissionsCached(owner, 'user-1');
    expect(calculate).toHaveBeenCalledTimes(2);
    calculate.mockRestore();
  });

  it('removes stale create permission IDs when object access is set to read-only', () => {
    const permissionIds = ['perm-create', 'perm-read'];
    const permissionCatalog = [
      { id: 'perm-create', name: 'LEAD_CREATE' },
      { id: 'perm-read', name: 'LEAD_READ' },
    ];

    const result = reconcilePermissionIdsForObjectPermissions(
      [{ objectId: 'lead-1', canCreate: false, canRead: true, canUpdate: false, canDelete: false, viewAll: false, modifyAll: false }],
      permissionIds,
      permissionCatalog,
      { 'lead-1': 'Lead' },
    );

    expect(result).toEqual(['perm-read']);
  });

  it('adds permission IDs for enabled profile object grants', () => {
    const result = reconcilePermissionIdsForObjectPermissions(
      [{ objectId: 'lead-1', canCreate: true, canRead: true, canUpdate: false, canDelete: false, viewAll: false, modifyAll: false }],
      [],
      [
        { id: 'lead-create', name: 'LEAD_CREATE' },
        { id: 'lead-read', name: 'LEAD_READ' },
        { id: 'lead-update', name: 'LEAD_UPDATE' },
      ],
      { 'lead-1': 'Lead' },
    );

    expect(result).toEqual(['lead-create', 'lead-read']);
  });

  it('removes stale delete permission IDs when delete access is disabled', () => {
    const permissionIds = ['perm-read', 'perm-delete'];
    const permissionCatalog = [
      { id: 'perm-read', name: 'LEAD_READ' },
      { id: 'perm-delete', name: 'LEAD_DELETE' },
    ];

    const result = reconcilePermissionIdsForObjectPermissions(
      [{ objectId: 'lead-1', canCreate: false, canRead: true, canUpdate: false, canDelete: false, viewAll: false, modifyAll: false }],
      permissionIds,
      permissionCatalog,
      { 'lead-1': 'Lead' },
    );

    expect(result).toEqual(['perm-read']);
  });

  it('clears object permission flags that no longer match the saved permission IDs', () => {
    const objectPermissions = [{
      objectId: 'proj-1',
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: true,
      viewAll: true,
      modifyAll: true,
    }];

    const permissionCatalog = [
      { id: 'perm-create', name: 'PROJECT_CREATE' },
      { id: 'perm-read', name: 'PROJECT_READ' },
      { id: 'perm-update', name: 'PROJECT_UPDATE' },
      { id: 'perm-delete', name: 'PROJECT_DELETE' },
      { id: 'perm-view-all', name: 'PROJECT_VIEW_ALL' },
      { id: 'perm-modify-all', name: 'PROJECT_MODIFY_ALL' },
    ];

    const result = reconcileObjectPermissionsForPermissionIds(
      objectPermissions,
      ['perm-read'],
      permissionCatalog,
      { 'proj-1': 'Project' },
    );

    expect(result).toEqual([{ objectId: 'proj-1', canCreate: false, canRead: true, canUpdate: false, canDelete: false, viewAll: false, modifyAll: false }]);
  });

  it('preserves View All and Manage All when the permission catalog has no matching IDs', () => {
    const result = reconcileObjectPermissionsForPermissionIds(
      [{ objectId: 'lead-1', canCreate: false, canRead: true, canUpdate: false, canDelete: false, viewAll: true, modifyAll: true }],
      ['lead-read'],
      [{ id: 'lead-read', name: 'LEAD_READ' }],
      { 'lead-1': 'Lead' },
    );

    expect(result).toEqual([{ objectId: 'lead-1', canCreate: false, canRead: true, canUpdate: false, canDelete: false, viewAll: true, modifyAll: true }]);
  });

  it('does not grant global access based only on an admin profile flag', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      profileId: 'profile-1',
      tenantId: 'tenant-1',
      isActive: true,
      isSuperAdmin: false,
    } as any);

    vi.spyOn(EffectivePermissionService, 'getProfilePermissions').mockResolvedValue([]);
    vi.spyOn(EffectivePermissionService, 'getPermissionSetPermissions').mockResolvedValue([]);
    vi.spyOn(EffectivePermissionService, 'getPermissionSetGroupPermissions').mockResolvedValue([]);
    vi.spyOn(EffectivePermissionService, 'getDirectPermissions').mockResolvedValue([]);

    const result = await EffectivePermissionService.getEffectivePermissions('user-1');

    expect(result).toEqual([]);
  });
});

describe('effective profile permissions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('includes object grants from the profile permission sets without requiring a role', async () => {
    vi.mocked(prisma.userProfilePermission.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.profileObjectPermission.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.permissionSet.findMany).mockResolvedValue([
      {
        name: 'SVC Site Visit Access',
        objectName: 'SiteVisit',
        permissions: { read: true, create: true, edit: true, delete: false },
      },
    ] as any);

    const result = await EffectivePermissionService.getProfilePermissions('profile-svc', 'tenant-1');

    expect(prisma.permissionSet.findMany).toHaveBeenCalled();
    expect(result.map((permission) => permission.name)).toEqual([
      'SITE_VISIT_CREATE',
      'SITE_VISIT_READ',
      'SITE_VISIT_UPDATE',
    ]);
    expect(result.every((permission) => permission.source === 'PROFILE')).toBe(true);
  });

  it('exposes Unit object grants from a profile as UNIT permissions', async () => {
    vi.mocked(prisma.userProfilePermission.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.permissionSet.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.profileObjectPermission.findMany).mockResolvedValue([
      {
        object: { name: 'Unit' },
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
        viewAll: false,
        modifyAll: false,
      },
    ] as any);

    const result = await EffectivePermissionService.getProfilePermissions('profile-svc', 'tenant-1');

    expect(result.map((permission) => permission.name)).toEqual([
      'UNIT_CREATE',
      'UNIT_READ',
      'UNIT_UPDATE',
      'UNIT_DELETE',
    ]);
  });
});

describe('effective permission name aliases', () => {
  const grantedPermission = (name: string) => ({
    name,
    module: 'LEAD',
    action: 'UPDATE',
    source: 'PERMISSION_SET' as const,
    sourceName: 'Sales Access',
  });

  it.each([
    ['LEAD_UPDATE', 'LEAD_EDIT'],
    ['LEAD_READ', 'LEAD_VIEW'],
    ['LEAD_DELETE', 'LEAD_DELECT'],
  ])('treats %s and %s as the same permission', (grantedName, requestedName) => {
    expect(EffectivePermissionService.hasPermissionIn([grantedPermission(grantedName)], requestedName)).toBe(true);
  });
});