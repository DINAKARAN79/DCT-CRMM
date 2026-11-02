import { describe, expect, it } from 'vitest';
import { getNavigationByProfile } from './sidebar';

describe('getNavigationByProfile', () => {
  it('does not grant all CRM modules to an admin profile without matching effective permissions', () => {
    const nav = getNavigationByProfile('Sales Executive', [], () => false, false, true);

    expect(nav.some((item) => item.href === '/setup')).toBe(true);
    expect(nav.some((item) => item.href === '/mis-approvals')).toBe(true);
    expect(nav.some((item) => item.href === '/leads')).toBe(false);
    expect(nav.some((item) => item.href === '/bookings')).toBe(true);
    expect(nav.some((item) => item.href === '/reports')).toBe(false);
  });

  it('grants module access only when the required effective permission exists', () => {
    const nav = getNavigationByProfile('Sales Executive', [], (perm) => perm === 'LEAD_READ' || perm === 'REPORT_VIEW', false, false);

    expect(nav.some((item) => item.href === '/leads')).toBe(true);
    expect(nav.some((item) => item.href === '/reports')).toBe(true);
    expect(nav.some((item) => item.href === '/opportunities')).toBe(false);
  });

  it('shows approval queue access only to MIS profiles and administrators', () => {
    const misNav = getNavigationByProfile('MIS', [], () => false, false, false);
    const misReviewerNav = getNavigationByProfile('MIS Quotation Reviewer', [], () => false, false, false);
    const salesNav = getNavigationByProfile('Sales', [], () => false, false, false);
    expect(misNav.some((item) => item.href === '/mis-approvals')).toBe(true);
    expect(misReviewerNav.some((item) => item.href === '/mis-approvals')).toBe(true);
    expect(salesNav.some((item) => item.href === '/mis-approvals')).toBe(false);
  });

});

describe('role-based sidebar matrix', () => {
  const withPerms = (...perms: string[]) => (perm: string) => perms.includes(perm);

  const presalesPerms = ['LEAD_READ', 'SITE_VISIT_READ', 'DASHBOARD_READ', 'REPORT_VIEW'];
  const salesPerms = [
    'LEAD_READ', 'SITE_VISIT_READ', 'DASHBOARD_READ',
    'PROJECT_READ', 'REPORT_VIEW',
  ];
  const crmPerms = [
    'LEAD_READ', 'SITE_VISIT_READ', 'DASHBOARD_READ',
    'PROJECT_READ', 'TASK_READ', 'REPORT_VIEW',
  ];
  const allPerms = [
    'LEAD_READ', 'SITE_VISIT_READ', 'PROJECT_READ', 'TASK_READ', 'UNIT_READ',
    'FOLLOW_UP_READ', 'REPORT_VIEW',
  ];

  it('Presales sees Home, Leads, Site Visits, and Reports', () => {
    const nav = getNavigationByProfile('Presales', [], withPerms(...presalesPerms), false, false);
    expect(nav.map((item) => item.title)).toEqual(['Home', 'Leads', 'Site Visits', 'Reports']);
  });

  it('SVC sees Units when Unit read access is granted', () => {
    const nav = getNavigationByProfile('SVC', [], withPerms(...presalesPerms, 'UNIT_READ'), false, false);
    expect(nav.map((item) => item.title)).toEqual(['Home', 'Leads', 'Site Visits', 'Units', 'Reports']);
  });

  it('Sales sees Leads, Site Visits, and Reports without removed commercial modules', () => {
    const nav = getNavigationByProfile('Sales', [], withPerms(...salesPerms), false, false);
    expect(nav.map((item) => item.title)).toEqual([
      'Home', 'Leads', 'Site Visits', 'Reports',
    ]);
  });

  it('CRM hides the lead module while keeping the booking-related workflow modules visible', () => {
    const nav = getNavigationByProfile('CRM', [], withPerms(...crmPerms), false, false);
    expect(nav.map((item) => item.title)).toEqual([
      'Home', 'Booking Details', 'Site Visits', 'Projects', 'Reports',
    ]);
    expect(nav.some((item) => item.href === '/leads')).toBe(false);
  });

  it('Admin does not show Pre Sales, Sales, or SVC in the sidebar', () => {
    const nav = getNavigationByProfile('Admin', [], withPerms(...allPerms), false, true);
    expect(nav.map((item) => item.title)).toEqual([
      'Home', 'Leads', 'Booking Details', 'Site Visits', 'MIS Approval', 'Projects', 'Units', 'Reports', 'Follow-ups', 'Setup',
    ]);
    expect(nav.some((item) => item.href === '/profiles/pre-sales')).toBe(false);
    expect(nav.some((item) => item.href === '/profiles/sales')).toBe(false);
    expect(nav.some((item) => item.href === '/profiles/svc')).toBe(false);
  });

  it('shows Units to non-admin profiles when Unit read access is granted', () => {
    const nav = getNavigationByProfile('Sales', [], withPerms(...allPerms), false, false);
    expect(nav.some((item) => item.title === 'Home')).toBe(true);
    expect(nav.some((item) => item.href === '/units')).toBe(true);
    expect(nav.some((item) => item.title === 'Reports')).toBe(true);
    expect(nav.some((item) => item.title === 'Leads')).toBe(true);
    expect(nav.some((item) => item.title === 'Tasks' || item.href === '/tasks')).toBe(false);
    expect(nav.some((item) => item.title === 'Follow-ups')).toBe(true);
    expect(nav.some((item) => item.title === 'Setup')).toBe(false);
  });

  it('Superadmin sees the superadmin navigation', () => {
    const nav = getNavigationByProfile(undefined, [], () => false, true, true);
    expect(nav.map((item) => item.title)).toEqual([
      'Home', 'Companies', 'Companies API', 'Custom Project Layouts',
      'Platform Dashboard', 'Dashboard Management', 'Report Management', 'Report Builder', 'Object Explorer', 'Tenant Analytics',
    ]);
  });
});