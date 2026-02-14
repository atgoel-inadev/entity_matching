export const SEED_PROFILES = {
  company: {
    profile_name: 'Company',
    entity_type: 'Company',
    description: 'Global company name resolution with semantic matching on name and exact matching on industry/country.',
    default_threshold: 0.65,
    fields: [
      { field_name: 'name', field_label: 'Company Name', match_strategy: 'SEMANTIC', weight: 6.0, is_required: true, is_primary_display: true },
      { field_name: 'industry', field_label: 'Industry', match_strategy: 'EXACT', weight: 1.0, is_required: false, is_primary_display: false },
      { field_name: 'country', field_label: 'Country', match_strategy: 'EXACT', weight: 1.0, is_required: false, is_primary_display: false },
    ],
    entities: [
      { fields: { name: 'Apple Inc.', industry: 'Technology', country: 'USA' }, display_name: 'Apple Inc.' },
      { fields: { name: 'Microsoft Corporation', industry: 'Technology', country: 'USA' }, display_name: 'Microsoft Corporation' },
      { fields: { name: 'Amazon.com Inc.', industry: 'E-Commerce', country: 'USA' }, display_name: 'Amazon.com Inc.' },
      { fields: { name: 'Alphabet Inc.', industry: 'Technology', country: 'USA' }, display_name: 'Alphabet Inc.' },
      { fields: { name: 'Meta Platforms Inc.', industry: 'Technology', country: 'USA' }, display_name: 'Meta Platforms Inc.' },
      { fields: { name: 'Tesla Inc.', industry: 'Automotive', country: 'USA' }, display_name: 'Tesla Inc.' },
      { fields: { name: 'JPMorgan Chase & Co.', industry: 'Banking', country: 'USA' }, display_name: 'JPMorgan Chase & Co.' },
      { fields: { name: 'Samsung Electronics', industry: 'Technology', country: 'South Korea' }, display_name: 'Samsung Electronics' },
      { fields: { name: 'Toyota Motor Corporation', industry: 'Automotive', country: 'Japan' }, display_name: 'Toyota Motor Corporation' },
      { fields: { name: 'Nestle SA', industry: 'Food & Beverage', country: 'Switzerland' }, display_name: 'Nestle SA' },
    ],
  },

  supplier: {
    profile_name: 'Supplier Dedup',
    entity_type: 'Supplier',
    description: 'Supplier deduplication with exact tax_id matching, fuzzy name, and location matching.',
    default_threshold: 0.5,
    fields: [
      { field_name: 'name', field_label: 'Supplier Name', match_strategy: 'SEMANTIC', weight: 4.0, is_required: true, is_primary_display: true },
      { field_name: 'tax_id', field_label: 'Tax ID', match_strategy: 'EXACT', weight: 5.0, is_required: false, is_primary_display: false },
      { field_name: 'city', field_label: 'City', match_strategy: 'FUZZY', weight: 1.0, is_required: false, is_primary_display: false },
      { field_name: 'country', field_label: 'Country', match_strategy: 'EXACT', weight: 1.0, is_required: false, is_primary_display: false },
    ],
    entities: [
      { fields: { name: 'Acme Supply Co', tax_id: '36-1234567', city: 'Chicago', country: 'USA' }, display_name: 'Acme Supply Co' },
      { fields: { name: 'Global Parts Manufacturing', tax_id: '13-9876543', city: 'Detroit', country: 'USA' }, display_name: 'Global Parts Manufacturing' },
      { fields: { name: 'Precision Components Ltd', tax_id: 'GB987654321', city: 'Manchester', country: 'UK' }, display_name: 'Precision Components Ltd' },
      { fields: { name: 'Shanghai Electronics Co', tax_id: 'CN110100001', city: 'Shanghai', country: 'China' }, display_name: 'Shanghai Electronics Co' },
      { fields: { name: 'Midwest Steel Works', tax_id: '41-5555555', city: 'Cleveland', country: 'USA' }, display_name: 'Midwest Steel Works' },
    ],
  },

  person: {
    profile_name: 'Person Match',
    entity_type: 'Person',
    description: 'Person matching with phonetic name matching, exact email/phone, and numeric ID.',
    default_threshold: 0.5,
    fields: [
      { field_name: 'first_name', field_label: 'First Name', match_strategy: 'PHONETIC', weight: 2.0, is_required: true, is_primary_display: true },
      { field_name: 'last_name', field_label: 'Last Name', match_strategy: 'PHONETIC', weight: 3.0, is_required: true, is_primary_display: false },
      { field_name: 'email', field_label: 'Email', match_strategy: 'EXACT', weight: 5.0, is_required: false, is_primary_display: false },
      { field_name: 'phone', field_label: 'Phone', match_strategy: 'NUMERIC', weight: 4.0, is_required: false, is_primary_display: false },
    ],
    entities: [
      { fields: { first_name: 'John', last_name: 'Smith', email: 'john.smith@acme.com', phone: '15550101' }, display_name: 'John Smith' },
      { fields: { first_name: 'Maria', last_name: 'Garcia', email: 'maria.garcia@example.com', phone: '525512345678' }, display_name: 'Maria Garcia' },
      { fields: { first_name: 'James', last_name: 'Wilson', email: 'jwilson@corp.com', phone: '15550202' }, display_name: 'James Wilson' },
      { fields: { first_name: 'Sarah', last_name: 'Johnson', email: 'sarah.j@example.com', phone: '15550303' }, display_name: 'Sarah Johnson' },
      { fields: { first_name: 'Wei', last_name: 'Zhang', email: 'wei.zhang@tech.cn', phone: '8613800138000' }, display_name: 'Wei Zhang' },
    ],
  },
};
