// L8: the api never reads an uploaded PDF itself (RC-135); a worker job does.
import { readPdf } from '@radcore/lib-platform';

export const read = readPdf;
