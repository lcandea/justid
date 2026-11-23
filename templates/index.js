// @ts-check
// Registry of the official templates. Adding a document type = add its files here.
// Tests check that every templates/*.js data file is listed and that versions match their family.
import dniEs from './dni_es.js';
import dniEsV3 from './dni_es_v3.js';
import dniEsV4 from './dni_es_v4.js';

/** Field catalogues + default visibility, one per document family. */
export const FAMILIES = [dniEs];

/** Concrete document versions (geometry + reference pictures). */
export const VERSIONS = [dniEsV4, dniEsV3];
