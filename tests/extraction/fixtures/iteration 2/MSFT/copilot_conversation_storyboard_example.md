# Example Copilot Engagement: From vague request → branded, PPT-convertible HTML storyboard

> **Purpose**: A real conversation transcript showing how to work with Copilot to (1) reframe a topic for exec audiences, (2) produce a modular storyboard, (3) output HTML constrained for PPTX conversion, and (4) create a branded variant using a brand token layer.

---

## Conversation transcript

### 1) User
Hi there,

I have recently been asked to help on an opportunity for a client of ours, a large universal bank headquartered in the UK. Past experiences with them has shown that they are well meaning, but slow and bureaucratic. As such the content of this opportunity is engaging with them to adopt agile ways of working for the technical delivery.

In this context I have been asked to provide some support in explaining to the bank the value of lean portfolio management (LPM). Previous engagement in this area has been focused on the technical side of LPM with an emphasis of integrating it into the Scale Agile Framework (SAFe).

This is not connecting with business users and what I think is needed is to recast this discussion to one of value and how to balance often difficult prioritisation conversations into one that are value driven and grounded in data and empiricism.

I have some collateral that our organisation has used to convey these topics before, but I think they are too detailed and do not fit in the frame of the conversations I need to have. My goal/ambition is to get a short story board (probably in the form of slides or the like, but we can get to that later) that I can share with senior business stakeholders that frames the problem and shows an approach to start engaging.

I need some help initially in the area of strategy and consulting, thinking of examples of how we pitch and storyboard some fundamental business strategy constructs. Later on I will probably also need some help in design and storytelling to craft this into however we want to display.

Again, I have collateral for each of these tasks, but wanted to start first with understanding how you would approach this and what you think is needed to frame the conversation.

### 1) Assistant
Provided an executive-friendly framing for LPM (value-led decisioning, transparency, empiricism), recommended a 10-slide storyboard spine, and pointed to internal collateral patterns (e.g., prioritisation/WSJF and value-based funding) as inputs while avoiding training-style material.

---

### 2) User
The audience is a bit of a challenge. Let’s take a step back first if you don’t mind. I am going to share some files to give some context.

There first is the annual report for Barclays Bank.

The second file, cfoev value realization practitioners guide is some of our methodology on value realisation.

The last file is a funding model strategy that addresses mechanics from current modelling to LPM.

Have a read and tell me what you think.

### 2) Assistant
Reviewed the documents and highlighted practical “nuggets” to bridge LPM into business language:
- Anchor on client strategy and priorities.
- Use value realisation (value hypotheses, KPIs, governance cadence) as the bridge.
- Use funding-transition framing (crawl/walk/run) to show a pragmatic path.

---

### 3) User
Let’s work on a storyboard please. To give further context, we have been invited from a bottom up approach to have the conversation. The first round is with the COO’s of each divisional business head, as well as their Portfolio lead. Getting buy in we are then progressing to divisional CEOs. Assuming that all lands, we would want to then take this to a Group ExCo with the CEO and his team. We likely will also need to align to CIO’s in each division and the overall CIO as they are holding the agile adoption and concepts of LPM, but again that is being indexed in very technical terms. It may mean we might want to have multiple decks, but I would like to start to see if we can have a common framing deck against your beats, and then deep dives later for each segment.

In drafting, let’s keep things to html at the moment.

### 3) Assistant
Produced a modular “common framing” HTML storyboard (10-slide structure) designed to work across audiences (COO/Portfolio lead → CEO → ExCo), with optional deep-dive modules for CIO and Finance later.

---

### 4) User
Thanks. I need to get the html in a state where I can share it. I’m going to give you some reference documents that constrain how you should generate this content. Read and follow all constraints in the attached documents. Where the documents conflict with your default behaviour, the documents take precedence.

Can we reformat this against the reference and get it to a state where I can download it?

### 4) Assistant
Reformatted the HTML to comply with the technical conversion guardrails:
- Each slide is a sibling `<section class="slide">`.
- Fixed slide frame 960×540.
- Restricted to supported elements.
- Clean hierarchy and whitespace.

Delivered a downloadable HTML file.

---

### 5) User
Thanks, I want to keep this as is, but cut another version in our own branding. Following the constraints I shared earlier, I am also attaching a brand tokenisation guide that I would like to read and follow to cut a new version that is in our own branding.

### 5) Assistant
Created a second version using the brand token layer:
- Light mode, core purple, neutrals.
- Graphik with Arial fallback.
- “>” brand marker on every slide.
- Kept conversion constraints intact.

Delivered a downloadable branded HTML file.

---

## Outputs produced

- **Unbranded PPT-convertible HTML**: `LPM_value_led_storyboard.html`
- **Accenture-branded PPT-convertible HTML**: `LPM_value_led_storyboard_accenture.html`

---

## Prompting patterns worth copying

### A) Start with the business problem, not the framework
- “This isn’t landing with business users. Help me recast this as value-driven prioritisation grounded in data and empiricism.”

### B) Provide audience and decision path early
- “First round is divisional COOs + portfolio lead → then divisional CEOs → then Group ExCo. CIOs hold the technical narrative.”

### C) Ask for a common spine + optional deep dives
- “Common framing deck against your beats; deep dives later for each segment.”

### D) Constrain output format explicitly
- “Keep it to HTML for now.”

### E) Provide technical + design constraints as reference docs
- “Follow these guardrails for HTML-to-PPT conversion.”

### F) Add brand token layer last
- “Keep content as-is; create a new branded version using the brand token guide.”

---

## Notes for sharing internally

- This transcript shows an effective cadence:
  1) establish narrative + audience
  2) ground in client context documents
  3) draft storyboard
  4) apply technical output constraints
  5) apply brand tokens

- The most reusable part is the request structure: **“common framing spine + constraints + branded variant”**.
