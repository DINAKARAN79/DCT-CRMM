-- Check LeadOwnerHistory table schema
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'LeadOwnerHistory' 
ORDER BY ordinal_position;

-- Check if there are any existing leads
SELECT COUNT(*) as lead_count FROM "Lead";

-- Check tenant details
SELECT id, name, slug, "maxTotalUsers", "maxAdminUsers" FROM "Tenant" WHERE slug = 'dct-re';
