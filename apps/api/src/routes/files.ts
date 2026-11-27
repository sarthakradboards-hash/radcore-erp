// Uploaded files' routes (RAD-43): declarations only. Each kind has its own read and write permissions.
import {
  defineRoute, deliveryNoteFileService, deliveryPhotoFileService, importFileService, itemPictureFileService, photoFileService, purchaseBillFileService, expenseBillFileService,
  resumeFileService, statementFileService,
} from '@radcore/lib-platform';
import {
  deliveryNoteFiles, deliveryPhotoFiles, importFiles, itemPictureFiles, photoFiles, purchaseBillFiles, expenseBillFiles, resumeFiles, statementFiles,
} from '@radcore/lib-platform/contract';

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
  // A delivered booking's checklist photo and signed note (RAD-117), under the bookings keys.
  defineRoute(deliveryPhotoFiles.startUpload, deliveryPhotoFileService.startUpload),
  defineRoute(deliveryPhotoFiles.confirmUpload, deliveryPhotoFileService.confirmUpload),
  defineRoute(deliveryPhotoFiles.downloadLink, deliveryPhotoFileService.downloadLink),
  defineRoute(deliveryNoteFiles.startUpload, deliveryNoteFileService.startUpload),
  defineRoute(deliveryNoteFiles.confirmUpload, deliveryNoteFileService.confirmUpload),
  defineRoute(deliveryNoteFiles.downloadLink, deliveryNoteFileService.downloadLink),
  // A supplier's bill as it came (RAD-138), under the bills keys.
  defineRoute(purchaseBillFiles.startUpload, purchaseBillFileService.startUpload),
  defineRoute(purchaseBillFiles.confirmUpload, purchaseBillFileService.confirmUpload),
  defineRoute(purchaseBillFiles.downloadLink, purchaseBillFileService.downloadLink),
  // An expense's bill as it came (RAD-152), under the expenses keys.
  defineRoute(expenseBillFiles.startUpload, expenseBillFileService.startUpload),
  defineRoute(expenseBillFiles.confirmUpload, expenseBillFileService.confirmUpload),
  defineRoute(expenseBillFiles.downloadLink, expenseBillFileService.downloadLink),
];
