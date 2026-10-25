-- Application-level audit records are append-only. DB owners can still administer
-- the database; export audit logs to a separately controlled retention sink.
CREATE FUNCTION facilityops_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON "Audit"
FOR EACH ROW EXECUTE FUNCTION facilityops_audit_immutable();
