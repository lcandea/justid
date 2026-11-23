// Pure data: one `export default` of a JSON object, nothing else (enforced by tests/unit/templates.test.mjs).
// Spanish ID card v4: zone geometry (fractions of the card, 0-1) and reference pictures.
export default {
  "kind": "version",
  "id": "dni_es_v4",
  "family": "dni_es",
  "default": true,
  "sample": { "front": "templates/ref/dni_es_v4_front.webp", "back": "templates/ref/dni_es_v4_back.webp" },
  "overrides": {},
  "zones": {
    "given_name": [
      { "side": "front", "x": 0.397, "y": 0.4335, "w": 0.3544, "h": 0.0571 }
    ],
    "surnames": [
      { "side": "front", "x": 0.3963, "y": 0.294, "w": 0.3566, "h": 0.0993 }
    ],
    "document_number": [
      { "side": "front", "x": 0.0165, "y": 0.1903, "w": 0.1677, "h": 0.0585 },
      { "side": "front", "x": 0.4405, "y": 0.174, "w": 0.3187, "h": 0.0764 }
    ],
    "photo": [
      { "side": "front", "x": 0.0177, "y": 0.2549, "w": 0.3601, "h": 0.6995 }
    ],
    "expiry_date": [
      { "side": "front", "x": 0.5907, "y": 0.6176, "w": 0.174, "h": 0.0511 }
    ],
    "birth_date": [
      { "side": "front", "x": 0.7902, "y": 0.5279, "w": 0.1795, "h": 0.048 }
    ],
    "issue_date": [
      { "side": "front", "x": 0.3953, "y": 0.6206, "w": 0.1755, "h": 0.041 }
    ],
    "sex": [
      { "side": "front", "x": 0.3962, "y": 0.5273, "w": 0.0778, "h": 0.046 }
    ],
    "nationality": [
      { "side": "front", "x": 0.5209, "y": 0.5253, "w": 0.114, "h": 0.0466 }
    ],
    "support_number": [
      { "side": "front", "x": 0.3961, "y": 0.7134, "w": 0.172, "h": 0.0519 },
      { "side": "front", "x": 0.7754, "y": 0.1849, "w": 0.1031, "h": 0.0378 },
      { "side": "back", "x": 0.1227, "y": 0.1609, "w": 0.1057, "h": 0.0412 }
    ],
    "signature": [
      { "side": "front", "x": 0.4059, "y": 0.7726, "w": 0.3727, "h": 0.1413 }
    ],
    "can": [
      { "side": "front", "x": 0.7804, "y": 0.8286, "w": 0.1829, "h": 0.0704 }
    ],
    "cli": [
      { "side": "front", "x": 0.8176, "y": 0.676, "w": 0.1458, "h": 0.0468 }
    ],
    "address": [
      { "side": "back", "x": 0.2796, "y": 0.0725, "w": 0.4892, "h": 0.2193 }
    ],
    "birth_place": [
      { "side": "back", "x": 0.2772, "y": 0.3423, "w": 0.4831, "h": 0.1035 }
    ],
    "parents_names": [
      { "side": "back", "x": 0.2785, "y": 0.5286, "w": 0.492, "h": 0.0568 }
    ],
    "issuing_office": [
      { "side": "back", "x": 0.0297, "y": 0.2925, "w": 0.0401, "h": 0.2534 }
    ],
    "mrz": [
      { "side": "back", "x": 0.03, "y": 0.66, "w": 0.94, "h": 0.3 }
    ]
  }
};
