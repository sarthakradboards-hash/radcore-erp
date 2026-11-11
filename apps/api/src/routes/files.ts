// Uploaded files' routes (RAD-43): declarations only. Each kind has its own read and write permissions.
import { defineRoute, importFileService, photoFileService, resumeFileService, statementFileService } from '@radcore/lib-platform';
import { importFiles, photoFiles, resumeFiles, statementFiles } from '@radcore/lib-platform/contract';

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
];
