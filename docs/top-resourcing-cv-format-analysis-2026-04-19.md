# Top Resourcing CV Formatting Sample Analysis

Date of review: 19 April 2026
Reviewed folder: `/Users/joetozerosullivan/Desktop/untitled folder`

## What was in the folder

The folder contains 8 `.eml` files and no standalone original CV files.

Unique email patterns found:

- 4 returned formatting emails from `Saj | CV Formatting <saj@topresourcing.co.uk>` with attached HMJ-branded `.docx` files.
- 2 duplicate copies of the George Syngros return email.
- 2 duplicate "Thank you" reply emails from HMJ with no attachments.

Unique returned `.docx` attachments recovered from the `.eml` files:

- `Alex Craven.docx`
- `Harry Watts.docx`
- `Seamus L Ardren.docx`
- `George Syngros.docx`

Quoted thread evidence also references a formatted CV for `David T.W.C. Davidson`, but that attachment is not present in the folder.

## Email timeline

- 13 January 2026: returned formatted CVs for `Harry Watts` and `Alex Craven`
- 12 February 2026: returned formatted CV for `Seamus L Ardren`
- 16 February 2026: returned formatted CV for `George Syngros`
- 12 February 2026, 20:38 UTC: HMJ "Thank you" reply preserved in duplicate `.eml` files

## What Top Resourcing appear to be doing

Across the sample, the service is mostly applying a fixed HMJ-branded Word template rather than performing deep recruiter-aware restructuring.

Common output pattern:

1. Cover page with HMJ logo and a table for:
   - Position
   - Candidate ID
   - Location
   - Relevant Data Centre Projects / Experience
   - Qualifications & Accreditations
   - Languages
   - Availability to Interview
2. Main profile pages with:
   - HMJ logo
   - large title
   - section headings such as `Profile`, `Qualifications`, `Key Skills`, `Employment History`
3. Light prose cleanup / normalisation of the original wording

## Quality issues in the sample

### 1. The sample is incomplete for true before/after comparison

The folder does **not** include the original CV attachments that were sent to Top Resourcing. That means we can inspect the returned formatting style, but we cannot measure precisely what text they added, removed, or rewrote from the originals.

### 2. Anonymisation is weak or absent

The returned files do not behave like genuinely anonymised client CVs:

- candidate names are preserved
- `Candidate ID` is often populated with the full candidate name rather than an anonymised reference
- one sample keeps a full postcode-level location
- one sample keeps `D.O.B 27/12/2000`

This is one of the clearest gaps between the outsourced output and the workflow HMJ actually needs.

### 3. Cover-page field completion is inconsistent

The structured first page is often under-used:

- `Position` is blank in some files
- `Relevant Data Centre Projects / Experience` is often blank
- `Qualifications & Accreditations` is often blank
- `Availability to Interview` is blank
- `Location` is sometimes blank

So the template exists, but the field-mapping quality is inconsistent.

### 4. The rewrite quality is mixed

Top Resourcing do improve presentation, but the result is not consistently strong:

- some profiles are polished and recruiter-readable
- some profiles remain quite close to raw source wording
- the service does not reliably surface role-relevant highlights on the front page
- role alignment to a specific brief is not visible in the sample set

### 5. The process looks template-led, not recruiter-led

The sample suggests a workflow closer to:

- extract readable text
- pour it into a branded template
- tidy headings and paragraphs

rather than:

- understand target role
- tailor emphasis to that role
- anonymise correctly
- present strongest matching experience first

## Reverse-engineered template observations

Consistent document features across the returned `.docx` files:

- single HMJ logo image reused across documents
- cover page uses a bordered two-column table
- main content page uses underlined section headings
- no footer content was found in the sample
- document metadata shows the same creator: `Nick Chamberlain`

## What the app should do instead

Based on this review, the replacement workflow should be:

1. Upload candidate CV (`.pdf`, `.doc`, `.docx`)
2. Optionally upload job spec (`.pdf`, `.doc`, `.docx`)
3. Extract readable text
4. Remove direct personal identifiers properly
5. Use AI to:
   - structure the CV cleanly
   - sharpen wording
   - prioritise the most role-relevant content
   - keep chronology factual
   - avoid inventing experience
6. Generate a branded HMJ Word document
7. Download the final `.docx` locally

## Recommended next dataset to improve accuracy

To tune the formatter against real Top Resourcing behaviour, HMJ should gather a better benchmark set:

- original raw CV
- Top Resourcing returned version
- target job spec used for submission, if any

Even 10 to 20 complete before/after pairs would make the tailoring and section-mapping much easier to tune.
