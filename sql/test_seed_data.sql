-- sql/test_seed_data.sql
-- Seed script to refresh portal data with 10 representative records per entity.
-- Truncates the main delivery tables and inserts fresh fixtures.
-- Status mix: 8/10 candidates set to Live (with assignments) and 8/10 timesheets submitted/approved (75%+ complete).

BEGIN;

TRUNCATE TABLE
  public.timesheet_entries,
  public.timesheets,
  public.assignments,
  public.candidates,
  public.contractors,
  public.sites,
  public.projects,
  public.clients,
  public.job_email_logs,
  public.job_shares,
  public.job_sections,
  public.jobs
RESTART IDENTITY CASCADE;

INSERT INTO public.clients (id, name, status, contact_name, contact_email, billing_email, phone)
VALUES
  (101, 'Northwind Utilities', 'active', 'Alice Carter', 'alice.carter@example.com', 'accounts@northwind.test', '+44 1610 001001'),
  (102, 'Brighton Renewables', 'active', 'Daniel Watts', 'daniel.watts@example.com', 'finance@brightonrenewables.test', '+44 1273 110022'),
  (103, 'Seabourne Construction', 'active', 'Freya Collins', 'freya.collins@example.com', 'accounts@seabourne.test', '+44 1903 220033'),
  (104, 'Northern Rail Build', 'active', 'Imran Rahman', 'imran.rahman@example.com', 'finance@nrb.test', '+44 1130 330044'),
  (105, 'Greenfield Logistics', 'active', 'Harriet Lewis', 'harriet.lewis@example.com', 'payables@greenfield.test', '+44 1210 550055');

INSERT INTO public.projects (id, client_id, name, active)
VALUES
  (201, 101, 'HVAC Retrofit - Manchester', true),
  (202, 101, 'Control System Upgrade - Salford', true),
  (203, 102, 'Offshore Turbine Service', true),
  (204, 102, 'Battery Storage Commissioning', true),
  (205, 103, 'Hospital Wing Extension', true),
  (206, 103, 'Coastal Flood Defences', true),
  (207, 104, 'Rolling Stock Refurb', true),
  (208, 104, 'Metro Signalling Upgrade', true),
  (209, 105, 'Distribution Hub Automation', true),
  (210, 105, 'Cold Store Expansion', true);

INSERT INTO public.sites (id, client_id, name, address)
VALUES
  (301, 101, 'Manchester Plant', '1 Riverside Way, Manchester'),
  (302, 101, 'Salford Quays', '22 Harbour St, Salford'),
  (303, 102, 'Brighton Marina', 'Marina Point, Brighton'),
  (304, 102, 'Shoreham Port', 'Dockside Rd, Shoreham'),
  (305, 103, 'St. Anne''s Hospital', '17 West Parade, Worthing'),
  (306, 103, 'Coastal Works Compound', 'Seaside Rd, Littlehampton'),
  (307, 104, 'Leeds Depot', '45 Rail Yard Way, Leeds'),
  (308, 104, 'Sheffield Control Centre', '99 Midland St, Sheffield'),
  (309, 105, 'Midlands Hub', '12 Logistics Park, Derby'),
  (310, 105, 'Solihull Cold Store', '6 Chill Lane, Solihull');

INSERT INTO public.contractors (id, name, email, phone, payroll_ref, pay_type)
VALUES
  (401, 'Elliot Price', 'elliot.price@example.com', '+44 7700 900401', 'PR401', 'PAYE'),
  (402, 'Priya Singh', 'priya.singh@example.com', '+44 7700 900402', 'PR402', 'PAYE'),
  (403, 'Noah Bennett', 'noah.bennett@example.com', '+44 7700 900403', 'PR403', 'Umbrella'),
  (404, 'Sofia Martinez', 'sofia.martinez@example.com', '+44 7700 900404', 'PR404', 'PAYE'),
  (405, 'Leo Armstrong', 'leo.armstrong@example.com', '+44 7700 900405', 'PR405', 'PAYE'),
  (406, 'Maya Patel', 'maya.patel@example.com', '+44 7700 900406', 'PR406', 'Umbrella'),
  (407, 'Benjamin Clarke', 'ben.clarke@example.com', '+44 7700 900407', 'PR407', 'PAYE'),
  (408, 'Charlotte Green', 'charlotte.green@example.com', '+44 7700 900408', 'PR408', 'Umbrella'),
  (409, 'Oliver Hughes', 'oliver.hughes@example.com', '+44 7700 900409', 'PR409', 'PAYE'),
  (410, 'Lily Fraser', 'lily.fraser@example.com', '+44 7700 900410', 'PR410', 'PAYE');

INSERT INTO public.candidates (id, first_name, last_name, email, phone, job_title, status, client_name, start_date, timesheet_status)
VALUES
  (501, 'Elliot', 'Price', 'elliot.price@example.com', '+44 7700 900401', 'Mechanical Supervisor', 'Live', 'Northwind Utilities', '2024-04-08', 'Approved'),
  (502, 'Priya', 'Singh', 'priya.singh@example.com', '+44 7700 900402', 'Electrical Engineer', 'Live', 'Northwind Utilities', '2024-04-15', 'Approved'),
  (503, 'Noah', 'Bennett', 'noah.bennett@example.com', '+44 7700 900403', 'Wind Turbine Tech', 'Live', 'Brighton Renewables', '2024-04-15', 'Submitted'),
  (504, 'Sofia', 'Martinez', 'sofia.martinez@example.com', '+44 7700 900404', 'Commissioning Lead', 'Live', 'Brighton Renewables', '2024-04-22', 'Submitted'),
  (505, 'Leo', 'Armstrong', 'leo.armstrong@example.com', '+44 7700 900405', 'Site Foreman', 'Live', 'Seabourne Construction', '2024-03-25', 'Approved'),
  (506, 'Maya', 'Patel', 'maya.patel@example.com', '+44 7700 900406', 'Civils Supervisor', 'Live', 'Seabourne Construction', '2024-04-01', 'Draft'),
  (507, 'Benjamin', 'Clarke', 'ben.clarke@example.com', '+44 7700 900407', 'Rail Electrician', 'Live', 'Northern Rail Build', '2024-04-08', 'Approved'),
  (508, 'Charlotte', 'Green', 'charlotte.green@example.com', '+44 7700 900408', 'Signalling Engineer', 'Live', 'Northern Rail Build', '2024-04-29', 'Submitted'),
  (509, 'Oliver', 'Hughes', 'oliver.hughes@example.com', '+44 7700 900409', 'Warehouse Operative', 'Interview', 'Greenfield Logistics', NULL, 'Draft'),
  (510, 'Lily', 'Fraser', 'lily.fraser@example.com', '+44 7700 900410', 'Cold Store Manager', 'Prospect', 'Greenfield Logistics', NULL, 'Draft');

INSERT INTO public.assignments (
  id, contractor_id, project_id, site_id, rate_std, rate_ot, charge_std, charge_ot,
  start_date, end_date, active, status, job_title, consultant_name, candidate_name,
  client_name, client_site, pay_freq, currency, days_per_week, hours_per_day,
  ts_type, shift_type, rate_pay, rate_charge, auto_ts, approver, notes
)
VALUES
  (601, 401, 201, 301, 32.50, 48.75, 45.00, 62.50, '2024-04-08', NULL, true, 'live', 'Mechanical Supervisor', 'Amelia Shaw', 'Elliot Price', 'Northwind Utilities', 'Manchester Plant', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 32.50, 45.00, false, 'approvals@northwind.test', 'Night cover required in July'),
  (602, 402, 202, 302, 30.00, 45.00, 42.00, 60.00, '2024-04-15', NULL, true, 'live', 'Electrical Engineer', 'Amelia Shaw', 'Priya Singh', 'Northwind Utilities', 'Salford Quays', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 30.00, 42.00, false, 'approvals@northwind.test', 'Covering PLC upgrade'),
  (603, 403, 203, 303, 28.00, 42.00, 40.00, 58.00, '2024-04-15', NULL, true, 'live', 'Wind Turbine Tech', 'James Oliver', 'Noah Bennett', 'Brighton Renewables', 'Brighton Marina', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 28.00, 40.00, false, 'ops@brightonrenewables.test', 'Travel Monday AM'),
  (604, 404, 204, 304, 34.00, 51.00, 48.00, 68.00, '2024-04-22', NULL, true, 'live', 'Commissioning Lead', 'James Oliver', 'Sofia Martinez', 'Brighton Renewables', 'Shoreham Port', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 34.00, 48.00, false, 'ops@brightonrenewables.test', 'Weekend standby 1-in-4'),
  (605, 405, 205, 305, 26.50, 39.75, 38.00, 54.00, '2024-03-25', NULL, true, 'live', 'Site Foreman', 'Rebecca Mills', 'Leo Armstrong', 'Seabourne Construction', 'St. Anne''s Hospital', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 26.50, 38.00, false, 'projects@seabourne.test', 'Escalate safety issues same day'),
  (606, 406, 206, 306, 27.00, 40.50, 37.50, 54.00, '2024-04-01', NULL, true, 'live', 'Civils Supervisor', 'Rebecca Mills', 'Maya Patel', 'Seabourne Construction', 'Coastal Works Compound', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 27.00, 37.50, false, 'projects@seabourne.test', 'Overseeing pump station works'),
  (607, 407, 207, 307, 29.00, 43.50, 41.00, 59.00, '2024-04-08', NULL, true, 'live', 'Rail Electrician', 'Owen Carter', 'Benjamin Clarke', 'Northern Rail Build', 'Leeds Depot', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Night', 29.00, 41.00, false, 'rail.ops@nrb.test', 'Night roster, Tue-Sat'),
  (608, 408, 208, 308, 33.00, 49.50, 46.00, 65.00, '2024-04-29', NULL, true, 'live', 'Signalling Engineer', 'Owen Carter', 'Charlotte Green', 'Northern Rail Build', 'Sheffield Control Centre', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 33.00, 46.00, false, 'rail.ops@nrb.test', 'Client review every Wednesday'),
  (609, 409, 209, 309, 21.50, 32.25, 32.00, 46.00, '2024-05-06', NULL, true, 'onboarding', 'Warehouse Operative', 'Hannah Webb', 'Oliver Hughes', 'Greenfield Logistics', 'Midlands Hub', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 21.50, 32.00, false, 'ops@greenfield.test', 'Shadowing senior team this month'),
  (610, 410, 210, 310, 27.50, 41.25, 39.00, 56.00, '2024-05-13', NULL, true, 'onboarding', 'Cold Store Manager', 'Hannah Webb', 'Lily Fraser', 'Greenfield Logistics', 'Solihull Cold Store', 'Weekly', 'GBP', 5, 8, 'e-Timesheet', 'Day', 27.50, 39.00, false, 'ops@greenfield.test', 'Starts once site handover complete');

INSERT INTO public.timesheets (
  id, assignment_id, week_ending, status, submitted_at, approved_at, approved_by,
  ts_ref, assignment_ref, candidate_id, candidate_name, client_name, week_start,
  total_hours, rate_pay, rate_charge, currency, pay_amount, charge_amount, notes
)
VALUES
  (701, 601, '2024-05-05', 'approved', '2024-05-06T09:00:00+00', '2024-05-07T12:15:00+00', 'approvals@northwind.test', 'TS-701', 'AS-601', 501, 'Elliot Price', 'Northwind Utilities', '2024-04-29', 40, 32.50, 45.00, 'GBP', 1300.00, 1800.00, 'All hours approved'),
  (702, 602, '2024-05-05', 'approved', '2024-05-06T10:00:00+00', '2024-05-08T14:20:00+00', 'approvals@northwind.test', 'TS-702', 'AS-602', 502, 'Priya Singh', 'Northwind Utilities', '2024-04-29', 38, 30.00, 42.00, 'GBP', 1140.00, 1596.00, 'Late finish on Thursday'),
  (703, 603, '2024-05-05', 'approved', '2024-05-06T08:30:00+00', '2024-05-07T11:45:00+00', 'ops@brightonrenewables.test', 'TS-703', 'AS-603', 503, 'Noah Bennett', 'Brighton Renewables', '2024-04-29', 40, 28.00, 40.00, 'GBP', 1120.00, 1600.00, 'Weather downtime Tuesday PM'),
  (704, 604, '2024-05-05', 'submitted', '2024-05-06T17:55:00+00', NULL, NULL, 'TS-704', 'AS-604', 504, 'Sofia Martinez', 'Brighton Renewables', '2024-04-29', 42, 34.00, 48.00, 'GBP', 1428.00, 2016.00, 'Includes Saturday call-out'),
  (705, 605, '2024-05-05', 'submitted', '2024-05-05T19:40:00+00', NULL, NULL, 'TS-705', 'AS-605', 505, 'Leo Armstrong', 'Seabourne Construction', '2024-04-29', 40, 26.50, 38.00, 'GBP', 1060.00, 1520.00, 'Awaiting site manager sign-off'),
  (706, 606, '2024-05-05', 'draft', NULL, NULL, NULL, 'TS-706', 'AS-606', 506, 'Maya Patel', 'Seabourne Construction', '2024-04-29', 28, 27.00, 37.50, 'GBP', 756.00, 1050.00, 'Hours partially entered'),
  (707, 607, '2024-05-05', 'approved', '2024-05-06T09:20:00+00', '2024-05-07T08:15:00+00', 'rail.ops@nrb.test', 'TS-707', 'AS-607', 507, 'Benjamin Clarke', 'Northern Rail Build', '2024-04-29', 44, 29.00, 41.00, 'GBP', 1276.00, 1804.00, 'Night shift premium applied'),
  (708, 608, '2024-05-05', 'approved', '2024-05-06T11:10:00+00', '2024-05-08T09:05:00+00', 'rail.ops@nrb.test', 'TS-708', 'AS-608', 508, 'Charlotte Green', 'Northern Rail Build', '2024-04-29', 40, 33.00, 46.00, 'GBP', 1320.00, 1840.00, 'On-site testing completed'),
  (709, 609, '2024-05-05', 'draft', NULL, NULL, NULL, 'TS-709', 'AS-609', 509, 'Oliver Hughes', 'Greenfield Logistics', '2024-04-29', 20, 21.50, 32.00, 'GBP', 430.00, 640.00, 'Training shifts only'),
  (710, 610, '2024-05-05', 'approved', '2024-05-06T16:00:00+00', '2024-05-08T10:30:00+00', 'ops@greenfield.test', 'TS-710', 'AS-610', 510, 'Lily Fraser', 'Greenfield Logistics', '2024-04-29', 40, 27.50, 39.00, 'GBP', 1100.00, 1560.00, 'Handover support logged');

INSERT INTO public.timesheet_entries (timesheet_id, day, hours_std, hours_ot, note)
VALUES
  -- Timesheet 701
  (701, 'Mon', 8, 0, NULL),
  (701, 'Tue', 8, 0, NULL),
  (701, 'Wed', 8, 0, NULL),
  (701, 'Thu', 8, 0, NULL),
  (701, 'Fri', 8, 0, NULL),
  (701, 'Sat', 0, 0, NULL),
  (701, 'Sun', 0, 0, NULL),
  -- Timesheet 702
  (702, 'Mon', 8, 0, NULL),
  (702, 'Tue', 8, 0, NULL),
  (702, 'Wed', 8, 0, NULL),
  (702, 'Thu', 10, 0, 'Overtime for commissioning'),
  (702, 'Fri', 4, 0, 'Training session'),
  (702, 'Sat', 0, 0, NULL),
  (702, 'Sun', 0, 0, NULL),
  -- Timesheet 703
  (703, 'Mon', 8, 0, NULL),
  (703, 'Tue', 6, 0, 'Weather stop PM'),
  (703, 'Wed', 8, 0, NULL),
  (703, 'Thu', 9, 0, 'Extra inspections'),
  (703, 'Fri', 9, 0, NULL),
  (703, 'Sat', 0, 0, NULL),
  (703, 'Sun', 0, 0, NULL),
  -- Timesheet 704
  (704, 'Mon', 8, 0, NULL),
  (704, 'Tue', 8, 0, NULL),
  (704, 'Wed', 8, 0, NULL),
  (704, 'Thu', 8, 0, NULL),
  (704, 'Fri', 6, 0, 'Left early for call-out'),
  (704, 'Sat', 4, 0, 'Call-out support'),
  (704, 'Sun', 0, 0, NULL),
  -- Timesheet 705
  (705, 'Mon', 8, 0, NULL),
  (705, 'Tue', 8, 0, NULL),
  (705, 'Wed', 8, 0, NULL),
  (705, 'Thu', 8, 0, NULL),
  (705, 'Fri', 8, 0, NULL),
  (705, 'Sat', 0, 0, NULL),
  (705, 'Sun', 0, 0, NULL),
  -- Timesheet 706
  (706, 'Mon', 6, 0, NULL),
  (706, 'Tue', 6, 0, NULL),
  (706, 'Wed', 6, 0, NULL),
  (706, 'Thu', 6, 0, NULL),
  (706, 'Fri', 4, 0, NULL),
  (706, 'Sat', 0, 0, NULL),
  (706, 'Sun', 0, 0, NULL),
  -- Timesheet 707
  (707, 'Mon', 8, 0, NULL),
  (707, 'Tue', 9, 0, 'Night shift'),
  (707, 'Wed', 9, 0, 'Night shift'),
  (707, 'Thu', 9, 0, 'Night shift'),
  (707, 'Fri', 9, 0, 'Night shift'),
  (707, 'Sat', 0, 0, NULL),
  (707, 'Sun', 0, 0, NULL),
  -- Timesheet 708
  (708, 'Mon', 8, 0, NULL),
  (708, 'Tue', 8, 0, NULL),
  (708, 'Wed', 8, 0, NULL),
  (708, 'Thu', 8, 0, NULL),
  (708, 'Fri', 8, 0, NULL),
  (708, 'Sat', 0, 0, NULL),
  (708, 'Sun', 0, 0, NULL),
  -- Timesheet 709
  (709, 'Mon', 4, 0, 'Induction'),
  (709, 'Tue', 4, 0, 'Training'),
  (709, 'Wed', 4, 0, 'Training'),
  (709, 'Thu', 4, 0, 'Shadowing'),
  (709, 'Fri', 4, 0, 'Shadowing'),
  (709, 'Sat', 0, 0, NULL),
  (709, 'Sun', 0, 0, NULL),
  -- Timesheet 710
  (710, 'Mon', 8, 0, NULL),
  (710, 'Tue', 8, 0, NULL),
  (710, 'Wed', 8, 0, NULL),
  (710, 'Thu', 8, 0, NULL),
  (710, 'Fri', 8, 0, NULL),
  (710, 'Sat', 0, 0, NULL),
  (710, 'Sun', 0, 0, NULL);

-- Job catalogue (10 records across four sections)
INSERT INTO public.job_sections (code, label, description, sort_order) VALUES
  ('commercial', 'Commercial', 'Quantity surveying and commercial management', 1),
  ('delivery', 'Project Delivery', 'Project managers and site leadership', 2),
  ('ict', 'Commissioning & ICT', 'BMS / EPMS / controls specialists', 3),
  ('life-sciences', 'Life Sciences', 'Pharma and cleanroom delivery', 4);

INSERT INTO public.jobs (
  id, title, status, section, section_label, discipline, type,
  location_text, location_code, overview, responsibilities, requirements,
  apply_url, keywords, published, sort_order, match_assignment, is_live
)
VALUES
  ('qs-london-dc', 'Quantity Surveyor — Data Centre', 'live', 'commercial', 'Commercial',
    'Data Centre', 'permanent', 'London, UK', 'london',
    'Lead cost control and commercial delivery on a flagship hyperscale data centre.',
    '["Cost reporting & CVRs","Change control","Stakeholder management","Supply chain payments"]'::jsonb,
    '["Degree in QS","Data centre experience","Strong NEC knowledge","Advanced Excel"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Quantity%20Surveyor%20%E2%80%94%20Data%20Centre',
    'quantity surveyor,data centre,commercial,NEC', true, 1, 'AS-1001', true),
  ('qs-eem-meps', 'Senior Quantity Surveyor — MEP', 'live', 'commercial', 'Commercial',
    'Data Centre', 'permanent', 'Eemshaven, NL', 'eemshaven',
    'Own MEP commercial strategy across procurement, reporting and change.',
    '["MEP procurement","Cash flow","Variation management","Client reporting"]'::jsonb,
    '["MEP QS background","Data centre exposure","Forecasting accuracy"]'::jsonb,
    'https://hmj-global.com/contact.html?role=MEP%20Senior%20Quantity%20Surveyor',
    'meps,qs,commercial,netherlands', true, 2, 'AS-1002', true),
  ('pm-dc-uk', 'Project Manager — Hyperscale', 'interviewing', 'delivery', 'Project Delivery',
    'Data Centre', 'permanent', 'Manchester, UK', 'manchester',
    'Coordinate multidisciplinary teams delivering hyperscale data centre fit out.',
    '["Programme integration","Interface management","Risk workshops","Client reporting"]'::jsonb,
    '["Mission-critical PM","MEP coordination","Stakeholder leadership"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Project%20Manager%20%E2%80%94%20Data%20Centre',
    'project manager,data centre,delivery', true, 3, 'AS-1010', true),
  ('smr-fitout', 'Site Manager — Fit Out', 'live', 'delivery', 'Project Delivery',
    'Data Centre', 'contract', 'Frankfurt, DE', 'frankfurt',
    'Run fast-track data hall fit outs through commissioning handover.',
    '["Daily coordination","Permit to work","Quality inspections","H&S leadership"]'::jsonb,
    '["Data hall fit out","SMSTS","Clean room awareness"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Site%20Manager%20%E2%80%94%20Fit%20Out',
    'site manager,fit out,data hall', true, 4, 'AS-1011', true),
  ('bms-lead', 'BMS Commissioning Lead', 'live', 'ict', 'Commissioning & ICT',
    'Controls', 'permanent', 'UK & Europe', 'uk',
    'Lead integrated testing for BMS/EPMS packages across multiple sites.',
    '["SAT/IST leadership","Vendor coordination","Issue tracking","Client reporting"]'::jsonb,
    '["BMS commissioning","Mission critical","QA/QC discipline"]'::jsonb,
    'https://hmj-global.com/contact.html?role=BMS%20Commissioning%20Lead',
    'bms,commissioning,data centre', true, 5, 'AS-1012', true),
  ('controls-engineer', 'Controls Engineer — Data Centre', 'draft', 'ict', 'Commissioning & ICT',
    'Controls', 'contract', 'Dublin, IE', 'dublin',
    'Support controls commissioning and punch list closure on hyperscale builds.',
    '["Loop checks","Trend tuning","Panel inspections","Reporting"]'::jsonb,
    '["HVAC/BMS knowledge","Commissioning experience"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Controls%20Engineer',
    'controls,data centre,commissioning', false, 6, NULL, false),
  ('planner-pharma', 'Senior Planner — Pharma', 'interviewing', 'life-sciences', 'Life Sciences',
    'Life Sciences', 'permanent', 'Macclesfield, UK', 'macclesfield',
    'Own Primavera P6 schedule on a complex cleanroom expansion.',
    '["P6 reporting","Scenario planning","Risk analysis","Client dashboards"]'::jsonb,
    '["Life sciences experience","P6 expert","Stakeholder comms"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Senior%20Planner%20%E2%80%94%20Life%20Sciences',
    'planner,life sciences,P6', true, 7, 'AS-1020', true),
  ('mech-super', 'Mechanical Supervisor — Pharma', 'live', 'life-sciences', 'Life Sciences',
    'Pharma', 'contract', 'Hull, UK', 'hull',
    'Supervise mechanical installation on GMP cleanroom project.',
    '["Daily briefings","RAMS reviews","Quality inspections","Progress reporting"]'::jsonb,
    '["Mechanical trade","GMP experience","SMSTS"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Mechanical%20Supervisor%20%E2%80%94%20Pharma',
    'mechanical supervisor,pharma', true, 8, 'AS-1021', true),
  ('permit-eu', 'Permit Engineer — HV Substations', 'live', 'delivery', 'Project Delivery',
    'Energy', 'permanent', 'Europe (travel)', 'eu',
    'Secure consents and manage permitting across pan-EU substation programme.',
    '["Permit applications","Stakeholder engagement","Documentation","Site visits"]'::jsonb,
    '["EU permitting","HV background","Travel flexibility"]'::jsonb,
    'https://hmj-global.com/contact.html?role=Permit%20Engineer',
    'permit engineer,hv,substations', true, 9, 'AS-1025', true),
  ('estimator-bess', 'MEP Estimator — BESS', 'interviewing', 'commercial', 'Commercial',
    'Energy', 'permanent', 'UK (Hybrid)', 'uk',
    'Develop cost plans and tenders for UK-wide BESS and substation schemes.',
    '["Cost planning","Supplier liaison","Risk allowances","Bid support"]'::jsonb,
    '["Estimating background","BESS/Substation experience"]'::jsonb,
    'https://hmj-global.com/contact.html?role=MEP%20Estimator',
    'estimator,bess,substation', true, 10, 'AS-1026', true);

-- Seed one share and one email log for diagnostics
INSERT INTO public.job_shares (token, job_id, payload, expires_at)
VALUES
  ('seed-token-1', 'qs-london-dc', '{"id":"qs-london-dc","title":"Quantity Surveyor — Data Centre"}', NOW() + INTERVAL '45 days');

INSERT INTO public.job_email_logs (job_id, recipients, subject, sent, provider, payload)
VALUES
  ('qs-london-dc', ARRAY['client@example.com'], 'Role spotlight — Quantity Surveyor', true, 'resend', '{"preview":"seed"}'::jsonb);

COMMIT;
