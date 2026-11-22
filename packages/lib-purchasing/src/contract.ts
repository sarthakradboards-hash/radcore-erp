// lib-purchasing's route contracts (ADR-001 §6; ADR-008): each document's in a file of its own, re-exported here. Like
// every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
// Purchase orders (M4-01, RAD-136).
export * from './contract/orders.ts';
