// Uploaded files' routes (RAD-43): declarations only. Each kind has its own read and write permissions.
import {
  defineRoute, importFileService, itemPictureFileService, photoFileService, resumeFileService, statementFileService,
} from '@radcore/lib-platform';
import { importFiles, itemPictureFiles, photoFiles, resumeFiles, statementFiles } from '@radcore/lib-platform/contract';

export default [
  defineRoute(photoFiles.startUpload, photoFileService.startUpload),
  defineRoute(photoFiles.confirmUpload, photoFileService.confirmUpload),
  defineRoute(photoFiles.downloadLink, photoFileService.downloadLink),
  defineRoute(resumeFiles.startUpload, resumeFileService.startUpload),
  defineRoute(resumeFiles.confirmUpload, resumeFileService.confirmUpload),
  defineRoute(resumeFiles.downloadLink, resumeFileService.downloadLink),
  defineRoute(statementFiles.startUpload, statementFileService.startUpload),
  defineRoute(statementFiles.confirmUpload, statementFileService.confirmUpload),
  defineRoute(statementFiles.downloadLink, statementFileService.downloadLink),
  defineRoute(importFiles.startUpload, importFileService.startUpload),
  defineRoute(importFiles.confirmUpload, importFileService.confirmUpload),
  defineRoute(importFiles.downloadLink, importFileService.downloadLink),
  // Item pictures (RAD-89): upload and confirm only; they're seen through the item's answer, inline.
  defineRoute(itemPictureFiles.startUpload, itemPictureFileService.startUpload),
  defineRoute(itemPictureFiles.confirmUpload, itemPictureFileService.confirmUpload),
];
