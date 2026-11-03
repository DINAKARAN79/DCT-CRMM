SELECT DISTINCT status, COUNT(*) as count FROM "Lead" GROUP BY status ORDER BY status;
