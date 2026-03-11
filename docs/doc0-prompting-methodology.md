# Working With AI

## A Prompting Methodology for Visual Content Creation

### Version 1.2

> **Purpose:** This document teaches you how to work *with* AI engines effectively when creating visual content — presentations, webapps, reports, and other communication materials. It is not about the content itself or the technical format. It is about the *interaction pattern* that produces the best results.
>
> **The core idea:** AI engines are collaborators, not vending machines. The quality of your output depends on how you engage with the engine, not just what you ask for.
>
> **Who this is for:** Consultants creating visual content using AI tools (Claude, ChatGPT, Copilot, or others). No technical background required.

---

## The problem we're solving

Most people interact with AI like this:

> "Create a 10-slide PowerPoint about digital transformation for a CIO audience."

The AI produces something. It looks plausible. The consultant spends the next two hours fixing it — adjusting fonts, rebalancing content, correcting the narrative flow, applying brand colours, and trying to make it feel like professional work rather than AI output.

This is the **command model**. You give an instruction, the AI executes, you clean up. It feels fast but it isn't. The cleanup time often exceeds what it would have taken to build the content yourself, and the result still carries the generic, slightly-off quality of unguided AI output.

There is a better way.

---

## The partner model

Effective AI collaboration follows the same pattern as effective delegation to a smart but new team member. You wouldn't hand a new joiner a topic and say "make me a deck." You would brief them, explain the context, share the standards, review their approach, and iterate together.

The partner model has four stages:

### Stage 1 — Think together

Before any formatting or design, work with the AI on the *intellectual problem*. What are you trying to communicate? Who is the audience? What do they need to understand, and what should they do differently afterwards?

**Example prompt:**

> "I need to present a case for adopting agile ways of working to senior IT leadership. The audience is sceptical — they've seen transformation programmes fail before. Help me structure an argument that addresses their concerns while building confidence in the approach. What are the key messages, and in what order should I present them?"

At this stage, you are not asking for slides, HTML, or any formatted output. You are asking the AI to think with you. Challenge its suggestions. Push back. Refine the narrative until it's sharp.

If you have source documents (client annual reports, internal methodology, prior deliverables), provide them and ask the AI to analyse them before producing anything. "Have a read and tell me what you think" is a more productive prompt than "make slides from these." The connections the AI draws across multiple documents often surface insights you wouldn't get from working with each in isolation.

**Key technique — ask before you tell.** When you have a hypothesis or a preferred direction, resist the urge to share it immediately. Instead, ask the AI for its independent read on the materials first. "What patterns do you see across these documents?" or "How would you frame this for a sceptical COO audience?" will surface perspectives and connections that you might not have prioritised.

Once you share your opinion, you anchor the conversation — the AI will naturally weight its response toward your stated view. By asking first, you get an independent synthesis that can strengthen, challenge, or reframe your thinking before it becomes the direction. This is the single most effective technique for getting genuine value from AI collaboration rather than just faster execution of your existing plan.

After you've heard the AI's perspective, then share your hypothesis and work together to refine the approach. The combination of the AI's unanchored analysis and your domain expertise and judgement consistently produces better outcomes than either alone.

**What good looks like:** A clear outline of 3–6 key messages, a logical sequence, an identified audience and their concerns, and a clear call to action — all agreed before any visual work begins. Critically, the narrative should reflect both your strategic intent and insights surfaced by the AI's independent analysis of the source material.

### Stage 2 — Set the constraints

Once the content is clear, tell the AI *how* to express it. This is where the design system documents come in. Attach the relevant documents and explain what role they play:

**Example prompt:**

> "Now I want to express this as HTML that can be converted to PowerPoint. I've attached three documents:
>
> 1. A technical output profile that defines what HTML/CSS is supported — follow every constraint in this document.
> 2. Design principles for effective visual communication — apply these to how you structure and present the content.
> 3. Brand tokens for Accenture — use these specific colours, fonts, and visual identity rules.
>
> Read all three documents before generating any output. Where the documents conflict with your default behaviour, the documents take precedence."

The framing line at the end is important. Without it, some engines treat attached documents as suggestions rather than specifications.

**What to attach when:**

| Situation | Documents to attach |
|---|---|
| Exploring an idea, no format decided yet | None — just think together |
| Creating unbranded content for internal use | Doc 1 (Technical Profile) + Doc 2 (Design Principles) |
| Creating branded content | Doc 1 + Doc 2 + Doc 3 (Brand Tokens) |
| Creating content for a different medium (webapp, PDF) | Doc 2 + the relevant technical profile for that medium |
| Reviewing or improving existing content | Doc 2 (for design critique) and/or Doc 3 (for brand compliance check) |

### Stage 3 — Generate and review

Ask the AI to generate the content. Then *review it critically* before accepting it.

**What to check:**

- **Does each section have one clear message?** If you can't state the key point of a slide in one sentence, it needs restructuring.
- **Does the reading flow work?** Can you scan each section in five seconds and grasp the hierarchy?
- **Is the content balanced?** Are parallel elements (cards, steps, columns) approximately equal in depth?
- **Are the constraints followed?** No JavaScript, no gradients, no emoji icons, correct slide dimensions, brand colours applied.
- **Does it sound right?** Read the text aloud. If it sounds stilted or full of jargon, ask the AI to rewrite in plain language.

**Example review prompt:**

> "This is good, but Slide 2 is too dense. The two-column layout has six bullet points on each side — it feels like a wall of text. Can you split this into two slides, with the tool recommendation on one and the selection criteria on the other? Keep the same visual treatment."

This is where the partner model pays off. You're not cleaning up after the AI — you're directing it. Each iteration should take the AI 30 seconds and save you 10 minutes of manual adjustment.

### Stage 4 — Refine and finalise

The final pass is about polish, not structure. At this point the content, layout, and brand should all be correct. You're looking for:

- Consistent punctuation (all bullet points end with full stops, or none do)
- Heading case consistency (sentence case throughout)
- Text balance across parallel elements
- Whitespace — does each section feel clean and professional, or crowded?
- Any last content adjustments based on what you've seen in the visual layout

**Example refinement prompt:**

> "The card text on Slide 1 is uneven — the third card has noticeably more text than the others. Can you trim it to match the length of the first two? Also, the recommendation box on Slide 2 could be more direct — lead with the action, not the context."

---

## Understanding your AI engine's instincts

Every AI engine has a default disposition — a set of instincts that shape its output before you say a word. These instincts are not bugs; they're consequences of how each engine was designed and what it was optimised for. Understanding them helps you work *with* the engine rather than fighting against it.

This matters because the same prompt given to three different engines will produce three different kinds of output — not because one is smarter than another, but because each has a different idea of what "helpful" means.

### The three flavours of eagerness

**Eagerness to impress (ChatGPT).** ChatGPT's default instinct is to produce an impressive, polished deliverable as quickly as possible. When it hears "create slides," it races to produce a finished artifact — often a PowerPoint file or an interactive webapp with JavaScript navigation — because it thinks you want the *final thing, fast*. This means it will frequently skip past your constraint documents in pursuit of a more impressive output, and may produce a wireframe-level first draft that needs nudging to become complete.

However, ChatGPT responds well to strong, explicit constraints. When provided with well-structured technical and design documents and told they are mandatory, ChatGPT can produce output that is both technically compliant and analytically substantive. The key is front-loading the constraints — attach all documents from the start with explicit framing — rather than correcting after the first draft.

**Eagerness to assemble (Copilot).** Copilot's default instinct is to find and assemble existing materials. Its integration with your corporate environment (OneDrive, SharePoint, email, Teams) means it immediately starts searching for relevant documents, prior presentations, and organisational context. This *feels* helpful — it's retrieving things you might need. But when you're trying to think fresh about a topic, this behaviour actively undermines you. It pulls in exactly the framing you're trying to move away from. For topics you've worked on before, your existing materials will dominate the conversation unless you explicitly tell Copilot to ignore them.

There is a second limitation beyond the organisational search instinct. Even when given strong source material and clear constraint documents, Copilot tends to produce thinner content than Claude or ChatGPT. It follows the technical constraints reliably — the output will be converter-compatible — but the analytical depth, narrative sophistication, and information density are typically lower. Think of Copilot as a capable formatter rather than a thinking partner. If the intellectual work is already done and you need it expressed quickly, Copilot delivers. If you need the AI to engage deeply with source material and produce substantive analysis, Claude or ChatGPT will give you more.

**Eagerness to understand (Claude).** Claude's default instinct is to understand the full context before committing to output. It will ask clarifying questions, develop the intellectual framework, and seek alignment on approach before generating anything. This produces better first drafts because the thinking happens upfront, but it can feel slower if you genuinely just need something formatted quickly. Claude is the engine most naturally suited to the partner model — it defaults to collaboration rather than execution.

### Why this matters for how you prompt

These instincts mean you need different prompting strategies for different engines:

**With ChatGPT:** Attach all constraint documents from the start and use the mandatory framing line ("Where the documents conflict with your default behaviour, the documents take precedence"). ChatGPT responds well to strong, explicit constraints — when the technical profile and design principles are both attached and framed as mandatory, it produces output that is technically compliant and visually sophisticated. State what you do NOT want clearly: "Produce static HTML only — do not create PowerPoint files. Do not use JavaScript or pseudo-elements." The first draft may still be lighter than Claude's; push for more depth and detail rather than starting over. ChatGPT iterates well.

**With Copilot:** Before any strategic or creative work, explicitly instruct it to NOT search your organisational files. Without this instruction, Copilot will default to assembling existing materials rather than helping you think differently.

Example instruction:

> "Do not reference any documents from my OneDrive, SharePoint, or email. I want you to work only from what I provide in this conversation and from your general knowledge. I am deliberately trying to reframe this topic, and existing materials will pull the conversation back to the framing I want to move away from."

Once you've developed the narrative fresh, you can selectively bring in organisational context later. But let the thinking happen first, uncorrupted by prior materials.

For substantive analytical work — decks that require insight, narrative structure, and data-anchored recommendations — prefer Claude or ChatGPT. Copilot produces converter-compatible HTML but the content will typically be thinner. If Copilot is your only available engine, compensate by doing more of the analytical work yourself in Stages 1 and 2 before asking for formatted output — give Copilot a more complete brief and it will format it reliably.

For formatted output (HTML, slides), Copilot needs more structural direction than other engines. Where Claude and ChatGPT can interpret "use a card grid" from the design principles, Copilot will likely need explicit layout instructions in your prompt: "Slide 1 must use a three-column card grid. Each card must have a heading and two bullet points."

**With Claude:** The layered approach works naturally. Start with Doc 1 alone to get conversion-safe output. Add Doc 2 for quality. Add Doc 3 for brand. You can build up iteratively within a single conversation. Claude responds well to being told *why* a constraint matters, not just *what* the constraint is — the design principles in Doc 2 include reasoning, and Claude applies them more consistently because it understands the intent.

### Choosing the right engine for the task

Different engines excel at different parts of the workflow:

| Task | Best engine | Why |
|---|---|---|
| Strategic thinking and narrative development | Claude | Deliberative, willing to challenge, develops framework before output |
| Comprehensive reference decks with deep appendices | ChatGPT | Produces the broadest coverage, systematic treatment of all angles |
| Quick assembly of existing materials | Copilot | Organisational integration retrieves and compiles efficiently |
| Branded, conversion-ready output in one pass | Claude | Follows constraint documents most reliably from the first attempt |
| Expanding a finalised spine into audience-specific variants | ChatGPT | Strong at systematic variation while maintaining consistency |
| Rapid formatting of a complete brief | Copilot or ChatGPT | When the thinking is done, the brief is detailed, and you need output fast |
| Data-anchored analytical presentations | Claude or ChatGPT | Both engage deeply with source data; Copilot produces thinner analysis |

If you have access to multiple engines, consider using them in sequence: Claude for the strategic narrative and branded spine deck, ChatGPT for expanding into appendices and audience-specific deep dives, Copilot for assembling supporting materials from your organisational knowledge base once the framing is locked.

---

## Common mistakes and how to avoid them

### Mistake 1: Asking for the final output first

**What happens:** "Make me a branded 5-slide deck about X." The AI produces something that looks finished but has poor narrative flow, inconsistent design, and generic content. You spend hours fixing it.

**Instead:** Start at Stage 1. Think first, format second. The 10 minutes you spend on narrative structure saves an hour of rework.

### Mistake 2: Attaching documents without explaining them

**What happens:** You attach the design system files but don't tell the AI what they are or that they're mandatory. The AI acknowledges them but cherry-picks from them, or ignores constraints that conflict with its defaults.

**Instead:** Explicitly state that the documents are binding constraints. Name each document and its role. Use the framing line: "Where the documents conflict with your default behaviour, the documents take precedence."

### Mistake 3: Accepting the first output

**What happens:** The AI generates something, you think "that's close enough," and you start manually editing in PowerPoint. You've now left the collaboration and entered solo rework mode.

**Instead:** Push back in the conversation. "The reading flow on Slide 3 doesn't work — the eye goes to the timeline before the heading. Can you increase the heading size and add more space above the timeline?" Three rounds of AI iteration is faster and better than one round of manual fixing.

### Mistake 4: Asking the AI to do everything at once

**What happens:** "Create a branded, conversion-ready, 8-slide deck with data visualisations, speaker notes, and an appendix about our Q3 transformation programme." The AI tries to satisfy every requirement simultaneously and produces mediocre output across all dimensions.

**Instead:** Break complex work into stages. Get the narrative right first. Then generate the visual output. Then refine section by section. Complex deliverables are built iteratively, not in one shot.

### Mistake 5: Fighting the engine instead of working with it

**What happens:** You spend half the conversation redirecting the AI away from its default behaviour — telling ChatGPT to stop generating PowerPoint, telling Copilot to stop pulling in old documents, telling Claude to just give you the output instead of asking more questions.

**Instead:** Read the engine instincts section above and adapt your approach to the engine you're using. Set expectations in your opening prompt. If you know ChatGPT will try to generate PPTX, say upfront: "Generate static HTML only — do not create PowerPoint files." If you know Copilot will search your files, block that behaviour in your first message. Work with the current, not against it.

### Mistake 6: Using one engine for everything

**What happens:** You default to whichever AI tool is easiest to access and use it for every task, regardless of whether it's the right tool for that particular job. The result is consistently adequate but never excellent.

**Instead:** Match the engine to the task. Use the task-engine table above as a guide. If you only have access to one engine, understand its strengths and limitations and adjust your prompting to compensate.

---

## The four documents — what they do and when to use them

The design system consists of four documents that layer on top of each other. Think of them as progressive refinement: each one adds a dimension of quality.

| Document | What it does | When to attach |
|---|---|---|
| **Doc 0** (`doc0-prompting-methodology.md`) | Teaches you how to work with AI | Read once, internalise, keep as reference |
| **Doc 1** (`doc1-technical-output-profile.md`) | Defines what HTML/CSS the converter can handle | Always, when generating HTML for conversion |
| **Doc 2** (`doc2-design-principles.md`) | Guides effective visual communication and tone of voice | Always, for any visual content |
| **Doc 3** (`doc3-brand-tokens.md`) | Specifies colours, fonts, logo, and brand rules | When output must be brand-compliant |

**The minimum viable prompt** for conversion-ready, branded content attaches Docs 1, 2, and 3 with the framing line that makes them mandatory.

**For exploration and early thinking**, attach nothing. Just talk to the AI.

**For unbranded internal work**, Doc 1 + Doc 2 gives you clean, well-designed output without brand identity.

**For brand review of existing content**, attach Doc 3 alone and ask the AI to assess compliance.

---

## A complete example

Here is a real interaction pattern that produced a 12-slide client-facing storyboard from raw inputs in a single session:

**Stage 1 — Think together (no documents attached):**
> "I need to explain lean portfolio management to senior business stakeholders at a UK bank. Previous attempts have been too technical and SAFe-indexed. Help me reframe this as a conversation about value-driven investment governance. The audience is sceptical — they're well-meaning but slow and bureaucratic."

*The AI proposed a five-beat narrative structure (situation → complication → question → answer → path forward) and asked clarifying questions about audience and pain points.*

**Source documents provided:**
> "Here's the client's annual report, our internal value realisation methodology, and a prior funding model deliverable. Have a read and tell me what you think."

*The AI analysed each document, drew connections across all three, and refined the storyboard. It anchored the narrative in the client's own language and targets, identified specific data points to use, and mapped the engagement sequence to the stakeholder hierarchy.*

**Audience and routing clarified:**
> "The first round is with divisional COOs and portfolio leads. Then CEOs. Then Group ExCo. CIOs in parallel. Can we have a common framing deck?"

*The AI adjusted the narrative for a bottom-up engagement path, with audience-specific flex notes at each beat.*

**Stage 2 — Set constraints:**
> "Let's work on the wireframe. I've attached three constraint documents — a technical output profile, design principles, and brand tokens. Follow all constraints. Where the documents conflict with your defaults, the documents take precedence."

**Stage 3 — Generate and review:**
> *The AI produced a 12-slide HTML deck. Review feedback:*
>
> "Slide 2 needs specific financial targets from the annual report — use >14% ROTE and Low 50s% cost-to-income. The contrast slide needs sharper 'today vs tomorrow' framing. And the transition into the resolution section needs a stronger hook."

**Stage 4 — Refine:**
> "Keep the content as-is but cut another version in our own branding."

**Result:** Two complete HTML decks (unbranded and Accenture-branded) ready for PowerPoint conversion, built from real client inputs, in a single working session. The intellectual substance, the visual design, and the brand identity were all handled collaboratively within the conversation.

---

## Quick reference: the partner model in four lines

1. **Think first.** Develop the argument before any formatting.
2. **Set constraints.** Attach the right documents and tell the AI they're mandatory.
3. **Review critically.** Don't accept the first output — iterate in conversation.
4. **Refine precisely.** Polish through specific, directed feedback.

---

## Document history

| Version | Date | Changes |
|---|---|---|
| 1.0 | Feb 2025 | Initial release |
| 1.1 | Feb 2025 | Added engine instinct analysis ("three flavours of eagerness"), corporate knowledge base warning for Copilot, task-engine matching guide, expanded engine-specific guidance based on cross-engine testing, updated example to reflect real LPM engagement |
| 1.2 | Mar 2026 | Refined engine characterisations based on empirical testing across Claude, ChatGPT, and Copilot with identical source material and constraint documents. Strengthened Copilot depth limitation guidance. Updated ChatGPT guidance to reflect improved compliance with strong constraints. Added data-anchored presentation to task-engine table. |
| — | — | Future: Gemini guidance when testing is complete |
| — | — | Future: Additional examples for different content types (webapp, report, video storyboard) |

---

*The best AI-generated content doesn't look AI-generated. It looks like the work of a thoughtful professional who happens to work fast. The difference is in how you collaborate, not which button you press.*
