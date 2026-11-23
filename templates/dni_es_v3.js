// Pure data: one `export default` of a JSON object, nothing else (enforced by tests/unit/templates.test.mjs).
// Spanish ID card v3: zone geometry (fractions of the card, 0-1) and reference pictures.
export default {
  "kind": "version",
  "id": "dni_es_v3",
  "family": "dni_es",
  "sample": { "front": "templates/ref/dni_es_v3_front.webp", "back": "templates/ref/dni_es_v3_back.webp" },
  "overrides": {},
  "zones": {
    "given_name": [
      { "side": "front", "x": 0.4002, "y": 0.4436, "w": 0.3544, "h": 0.0571 }
    ],
    "surnames": [
      { "side": "front", "x": 0.3958, "y": 0.3073, "w": 0.3566, "h": 0.0993 }
    ],
    "document_number": [
      { "side": "front", "x": 0.0963, "y": 0.9023, "w": 0.2703, "h": 0.0764 }
    ],
    "photo": [
      { "side": "front", "x": 0.0177, "y": 0.162, "w": 0.3669, "h": 0.73 }
    ],
    "expiry_date": [
      { "side": "front", "x": 0.5751, "y": 0.7221, "w": 0.1832, "h": 0.0511 }
    ],
    "birth_date": [
      { "side": "front", "x": 0.3978, "y": 0.6327, "w": 0.1795, "h": 0.048 }
    ],
    "sex": [
      { "side": "front", "x": 0.3979, "y": 0.536, "w": 0.0778, "h": 0.046 }
    ],
    "nationality": [
      { "side": "front", "x": 0.5336, "y": 0.537, "w": 0.114, "h": 0.0466 }
    ],
    "support_number": [
      { "side": "front", "x": 0.4009, "y": 0.7159, "w": 0.1609, "h": 0.0564 },
      { "side": "front", "x": 0.7547, "y": 0.1825, "w": 0.1031, "h": 0.0378 },
      { "side": "back", "x": 0.1391, "y": 0.1795, "w": 0.1057, "h": 0.0412 }
    ],
    "signature": [
      { "side": "front", "x": 0.4059, "y": 0.7916, "w": 0.3727, "h": 0.1709 }
    ],
    "can": [
      { "side": "front", "x": 0.7939, "y": 0.8469, "w": 0.1829, "h": 0.0704 }
    ],
    "cli": [
      { "side": "front", "x": 0.7898, "y": 0.6336, "w": 0.1458, "h": 0.0468 }
    ],
    "address": [
      { "side": "back", "x": 0.284, "y": 0.083, "w": 0.4892, "h": 0.2193 },
      { "side": "back", "x": 0.0363, "y": 0.0861, "w": 0.2461, "h": 0.0394 }
    ],
    "birth_place": [
      { "side": "back", "x": 0.2825, "y": 0.3516, "w": 0.4831, "h": 0.1035 }
    ],
    "parents_names": [
      { "side": "back", "x": 0.2785, "y": 0.5286, "w": 0.4918, "h": 0.0773 }
    ],
    "issuing_office": [
      { "side": "back", "x": 0.0366, "y": 0.2987, "w": 0.0401, "h": 0.2534 }
    ],
    "mrz": [
      { "side": "back", "x": 0.03, "y": 0.66, "w": 0.94, "h": 0.3 }
    ]
  }
};
