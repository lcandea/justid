#!/usr/bin/env python3
"""Junta todas las plantillas de js/templates/*.json en js/templates.js.

El navegador no puede listar carpetas y la app bloquea cualquier petición de red
(CSP connect-src 'none'), así que las plantillas se empaquetan en un script.
serve.py lo regenera solo en cada carga; para publicar la web sin serve.py,
ejecuta:  python3 build_templates.py
"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "js", "templates")
OUT = os.path.join(ROOT, "js", "templates.js")


def check(t, name):
    """Devuelve la lista de problemas de una plantilla (vacía si es válida)."""
    errs = []
    if not isinstance(t, dict):
        return ["no es un objeto JSON"]
    for k in ("id", "name"):
        if not isinstance(t.get(k), str) or not t[k].strip():
            errs.append(f"falta '{k}'")
    sample = t.get("sample")
    if sample is not None:
        if not isinstance(sample, dict) or not set(sample) <= {"front", "back"}:
            errs.append("'sample' must be {\"front\": path, \"back\": path}")
        else:
            for side, rel in sample.items():
                if not isinstance(rel, str) or not os.path.isfile(os.path.join(ROOT, rel)):
                    errs.append(f"sample.{side}: '{rel}' not found (build img/ref/ with tools/normalize_refs.py)")
    fields = t.get("fields")
    if not isinstance(fields, list) or not fields:
        return errs + ["'fields' vacío o ausente"]
    seen = set()
    for i, f in enumerate(fields):
        fid = f.get("id") if isinstance(f, dict) else None
        if not fid:
            errs.append(f"campo #{i + 1} sin id"); continue
        if fid in seen:
            errs.append(f"campo '{fid}' repetido")
        seen.add(fid)
        if not f.get("label"):
            errs.append(f"campo '{fid}' sin label")
        zones = f.get("zones")
        if not isinstance(zones, list) or not zones:
            errs.append(f"campo '{fid}' sin zonas"); continue
        for z in zones:
            if z.get("side") not in ("front", "back"):
                errs.append(f"campo '{fid}': side debe ser front o back")
            try:
                x, y, w, h = (float(z[k]) for k in ("x", "y", "w", "h"))
            except (KeyError, TypeError, ValueError):
                errs.append(f"campo '{fid}': zona sin x/y/w/h numéricos"); continue
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1
                    and x + w <= 1.001 and y + h <= 1.001):
                errs.append(f"campo '{fid}': zona fuera de la tarjeta (0–1)")
    return errs


def build(quiet=False):
    templates, ids = [], set()
    files = sorted(f for f in os.listdir(SRC) if f.endswith(".json")) if os.path.isdir(SRC) else []
    for fn in files:
        path = os.path.join(SRC, fn)
        try:
            with open(path, encoding="utf-8") as fh:
                t = json.load(fh)
        except (OSError, ValueError) as e:
            print(f"  ✗ {fn}: JSON no válido ({e})", file=sys.stderr); continue
        errs = check(t, fn)
        if not errs and t["id"] in ids:
            errs = [f"id '{t['id']}' repetido en otra plantilla"]
        if errs:
            print(f"  ✗ {fn}: " + "; ".join(errs), file=sys.stderr); continue
        ids.add(t["id"])
        templates.append(t)
        if not quiet:
            print(f"  ✓ {fn}: {t['name']} ({len(t['fields'])} datos)")
    # A template flagged "default": true goes first: it is the initial selection in the app and the editor.
    templates.sort(key=lambda t: not t.get("default"))
    body = json.dumps(templates, ensure_ascii=False, indent=1)
    js = ("'use strict';\n"
          "// GENERADO por build_templates.py a partir de js/templates/*.json. No lo edites a mano.\n"
          f"window.DOC_TEMPLATES = {body};\n")
    old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else None
    if js != old:
        with open(OUT, "w", encoding="utf-8") as fh:
            fh.write(js)
    return templates


if __name__ == "__main__":
    n = len(build())
    print(f"{n} plantilla(s) → js/templates.js")
