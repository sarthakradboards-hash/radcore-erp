-- RAD-91 (M2-12, RC-115, CA-34): the GST rates in force from 22 September 2025 for our goods (electric vehicles,
-- batteries, chargers, boards and spares), drafted from Notification No. 9/2025-Integrated Tax (Rate), dated 17 Sep
-- 2025, as corrected by its corrigendum of 18 Sep 2025, and confirmed by the CA before this merged (Sarthak: "Draft, CA
-- confirms"). The rate is the whole GST (IGST; CGST and SGST are half each). Each row names its schedule and entry.
-- Two entries are by description, not tariff code, so they're seeded at the code our goods carry, with a note:
-- electrically operated vehicles (Sch I, 441: all of chapter 87) at 8711 60, and EV chargers (Sch I, 438) at 8504 40.
INSERT INTO radcore.gst_rates (hsn, effective_from, rate, source, note) VALUES
  ('871160', '2025-09-22', 5, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch I, S. No. 441',
    'Electrically operated vehicles, including two and three wheeled electric vehicles and E-bicycles. The entry is chapter 87 by description; seeded at 8711 60 (motorcycles and cycles with an electric motor for propulsion).'),
  ('850440', '2025-09-22', 5, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch I, S. No. 438',
    'Charger or charging station for electrically operated vehicles. Other static converters of 8504 are 18% (Sch II, S. No. 477): an item of 8504 40 that isn''t an EV charger needs its own row.'),
  ('8714', '2025-09-22', 18, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch II, S. No. 547',
    'Parts and accessories of vehicles of heading 8711. Parts of non-motorised bicycles (8714 91 to 8714 99) are 5% (Sch I, S. No. 458) and need their own rows if sold.'),
  ('8507', '2025-09-22', 18, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch II, S. No. 480',
    'Electric accumulators, including separators therefor (batteries, lithium-ion included).'),
  ('8501', '2025-09-22', 18, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch II, S. No. 474',
    'Electric motors and generators (excluding generating sets): a motor sold on its own. A motor classed as a part of an 8711 vehicle takes 8714.'),
  ('4011', '2025-09-22', 18, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch II, S. No. 137',
    'New pneumatic tyres, of rubber, other than of a kind used on bicycles, cycle-rickshaws and three wheeled powered cycle rickshaws, rear tractor tyres and aircraft tyres.'),
  ('4013', '2025-09-22', 18, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch II, S. No. 139',
    'Inner tubes of rubber, other than of a kind used on bicycles, cycle-rickshaws and three wheeled powered cycle rickshaws, and rear tractor tyre tubes.'),
  ('9506', '2025-09-22', 5, 'Notification 9/2025-Integrated Tax (Rate), 17 Sep 2025, Sch I, S. No. 499',
    'Sports goods other than articles and equipment for general physical exercise (those are 18%, Sch II, S. No. 619). Boards that are sports goods; the CA confirms how our boards are classed.')
ON CONFLICT (hsn, effective_from) DO NOTHING;
