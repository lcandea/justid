// Pure data: one `export default` of a JSON object, nothing else (enforced by tests/unit/templates.test.mjs).
// Spanish ID card family: field catalogue and default visibility (show = visible by default).
// Labels live in locales/*.js as field.<id>; geometry lives in each version file.
export default {
  "kind": "family",
  "id": "dni_es",
  "fields": [
    { "id": "given_name", "show": true },
    { "id": "surnames", "show": true },
    { "id": "document_number", "show": true },
    { "id": "photo", "show": true },
    { "id": "expiry_date", "show": true },
    { "id": "birth_date", "show": true },
    { "id": "issue_date", "show": false },
    { "id": "sex", "show": false },
    { "id": "nationality", "show": false },
    { "id": "support_number", "show": false },
    { "id": "signature", "show": false },
    { "id": "can", "show": false },
    { "id": "cli", "show": false },
    { "id": "address", "show": false },
    { "id": "birth_place", "show": false },
    { "id": "parents_names", "show": false },
    { "id": "issuing_office", "show": false },
    { "id": "mrz", "show": false }
  ]
};
