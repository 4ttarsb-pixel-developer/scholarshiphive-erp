CREATE TABLE IF NOT EXISTS OfficeNetworkRules (
  Id INTEGER PRIMARY KEY AUTOINCREMENT,
  Name TEXT NOT NULL,
  Rule TEXT NOT NULL,
  IsActive INTEGER NOT NULL DEFAULT 1,
  CreatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS IX_OfficeNetworkRules_Active ON OfficeNetworkRules(IsActive);
INSERT INTO OfficeNetworkRules (Name,Rule,IsActive,CreatedAt)
SELECT o.Name,o.PublicIp,o.IsActive,o.CreatedAt
FROM OfficeNetworks o
WHERE NOT EXISTS (SELECT 1 FROM OfficeNetworkRules n WHERE lower(n.Name)=lower(o.Name) AND lower(n.Rule)=lower(o.PublicIp));
