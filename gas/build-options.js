// Apps Script's parser accepts less syntax than current Node/V8. In particular,
// dependency class fields must be lowered before Google validates the upload.
export const GAS_BACKEND_TARGET = 'es2019';
