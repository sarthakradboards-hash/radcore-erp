// Every permission key there is (RAD-36, ADR-001 §6a), with the module and words the permission matrix shows. A key
// not listed here can't be granted (`unknown_permission`). Each module's migration grants its own keys to the roles
// it names; its keys join this list with it. RAD-37's manifest test checks the list against the routes and the seed.

export type Permission = {
  readonly key: string;
  readonly module: string;
  readonly label: string;
  /** Only these roles may hold it, whatever the matrix says (D-20: only admin and owner see pay). */
  readonly onlyRoles?: readonly string[];
  /** A role holding it needs the second sign-in factor, whatever its own setting (D-19, RAD-83): keys that move money
   * or reach payroll, HR or user administration. Each such module's keys join with it. */
  readonly secondFactor?: boolean;
  /** The tables holding the records this key reaches, as `<db entry>#<table export>` ('@radcore/db/crm#leads'). Any
   * key may be granted at `own` scope, so a module service reading one of these applies the scope (E7, RAD-85). */
  readonly records?: readonly string[];
};

/** In the order the matrix shows them: by module, then by key. */
export const PERMISSIONS: readonly Permission[] = Object.freeze([
  { key: 'session:read', module: 'My work', label: 'Their own account: profile, password and sessions' },
  { key: 'users:read', module: 'Admin', label: 'See people and their sessions' },
  { key: 'users:write', module: 'Admin', label: 'Invite people, change their role, deactivate them', secondFactor: true },
  { key: 'roles:read', module: 'Admin', label: 'See roles and what each may do' },
  { key: 'roles:write', module: 'Admin', label: 'Change what each role may do', secondFactor: true },
  { key: 'audit:read', module: 'Admin', label: 'Read the audit trail and security events' },
  { key: 'company:read', module: 'Company', label: 'See the company’s name, GSTIN and address' },
  { key: 'company:write', module: 'Company', label: 'Set the company’s name, GSTIN and address, which every invoice prints' },
  { key: 'pii:read', module: 'Personal data', label: 'See personal details unmasked' },
  { key: 'pay:read', module: 'Personal data', label: 'See salaries and bank details', onlyRoles: ['admin', 'owner'], secondFactor: true },
  { key: 'photo_files:read', module: 'Files', label: 'See job photos' },
  { key: 'photo_files:write', module: 'Files', label: 'Upload job photos' },
  { key: 'resume_files:read', module: 'Files', label: 'See applicants’ résumés', secondFactor: true },
  { key: 'resume_files:write', module: 'Files', label: 'Upload applicants’ résumés', secondFactor: true },
  { key: 'statement_files:read', module: 'Files', label: 'See bank statements', secondFactor: true },
  { key: 'statement_files:write', module: 'Files', label: 'Upload bank statements', secondFactor: true },
  { key: 'import_files:read', module: 'Files', label: 'See import files' },
  { key: 'import_files:write', module: 'Files', label: 'Upload import files' },
].map((p) => Object.freeze(p)));

/**
 * The signed-in basics: every role keeps these, so nobody loses their own account, password and sessions to a
 * matrix edit. Every key comes only from a role's grants (RAD-35), so the matrix refuses to drop one. `session:write`
 * and My work's other keys join this list as they're declared.
 */
export const SIGNED_IN_BASICS: readonly string[] = Object.freeze(['session:read']);

/** The keys whose holder needs the second sign-in factor (D-19, RAD-83). */
export const SECOND_FACTOR_KEYS: readonly string[] = Object.freeze(PERMISSIONS.filter((p) => p.secondFactor).map((p) => p.key));

/** Every table some key's records live in: a module service reads one only with the record scope applied (E7). */
export const SCOPED_TABLES: readonly string[] = Object.freeze([...new Set(PERMISSIONS.flatMap((p) => p.records ?? []))].toSorted());
