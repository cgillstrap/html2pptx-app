# Chat + Claude Code Workflow Pattern

## The Problem This Solves

Chat sessions are good for thinking — architecture, diagnosis, trade-off discussions, reviewing output, making decisions. But they burn context on code production, which is mechanical and better handled by an agent that can read and write files directly.

Claude Code is good for doing — applying changes, running tests, iterating on implementation. But it lacks the interactive back-and-forth needed for design conversations and doesn't benefit from seeing screenshots or having nuanced discussions about approach.

Using both together, with clear handoff discipline, gets the best of each.

## The Three Files

Each project needs three coordination files:

### 1. `progress.md` — The Decision Journal (Chat-owned)

**Purpose:** Living record of what's been done, what's decided, and what's next. The handoff mechanism between chat sessions AND between chat and Claude Code.

**Updated by:** Chat sessions (always at checkpoint and session close). Claude Code updates the File Status table and phase checklists when it completes work.

**Contains:**
- Project goal and context
- Phase/task status with checkboxes
- File status table (which files changed, when, what changed)
- Key decisions log with rationale
- Known issues and test gaps
- **Next priorities** — this is what Claude Code reads to know what to do
- Session history (brief summary of each session's work)

**Key discipline:** The "Next Session Priorities" section must be specific enough for Claude Code to act on without further discussion. Good: "Implement font validation — check fontFace against SAFE_FONTS whitelist in extractor, push summary warning per slide." Bad: "Look at font stuff."

### 2. `CLAUDE.md` — The Project Brain (Stable reference)

**Purpose:** Gives Claude Code enough context to work autonomously on well-scoped tasks. It answers: "What is this project, how does it work, what are the rules, and where do I find the current state?"

**Updated by:** Chat sessions, infrequently — only when architecture, conventions, or boundaries change.

**Contains:**
- What the project is (brief)
- How to run and test
- Project structure
- Architecture rules (non-negotiable constraints)
- Module responsibilities (what goes where)
- Coding conventions
- Key technical details (data formats, important patterns)
- Pointer to progress.md for current state
- What NOT to do without chat discussion

**Key discipline:** This is reference material, not a task list. It should be stable across multiple sessions. If you're updating it every session, the content probably belongs in progress.md instead.

### 3. `project-context.md` — The Strategic Frame (Optional, for complex projects)

**Purpose:** For larger or more strategic projects, captures the broader context that shapes decisions: business goals, stakeholder landscape, constraints, principles that aren't code-specific.

**Updated by:** Chat sessions, rarely — only when strategic context shifts.

**Contains:**
- Business objectives and success criteria
- Stakeholder context and constraints
- Strategic principles and trade-offs
- Relationship to other initiatives
- Anything that answers "why are we building this?" rather than "how does this work?"

**When to use:** If the project has non-technical decision factors that affect technical choices. The html2pptx project folded this into progress.md (the "Broader Strategic Context" section) because it's a focused tool. A larger initiative would benefit from separating it.

## The Workflow

### Chat Session Flow

```
1. Start
   - Paste progress.md (and PRINCIPLES.md / project-context.md if relevant)
   - Attach source files per File Status table
   - State what to work on

2. Work (the valuable part)
   - Discuss architecture, review output, diagnose issues
   - Make design decisions with rationale
   - Agree on approach for implementation

3. Handoff — produce TWO outputs:
   a. Updated progress.md with:
      - Decisions recorded in the log
      - Next priorities written as actionable task descriptions
      - Session summary added to conversation history
   b. Task descriptions for Claude Code (if implementation is ready)
      - Can be in progress.md "Next Priorities" or given directly to the user

4. Close
   - User commits progress.md to repo
   - User optionally updates CLAUDE.md if architecture changed
```

### Claude Code Flow

```
1. Start
   - Reads CLAUDE.md (automatic, it's in the repo)
   - User points to progress.md or gives specific task

2. Work
   - Implements the scoped task
   - Follows coding conventions from CLAUDE.md
   - Tests against relevant fixtures

3. Handoff
   - Updates File Status table in progress.md
   - Checks off completed items in phase checklist
   - Commits with descriptive message
   - Notes any issues or decisions needed in progress.md
     (flagged for chat discussion, not resolved autonomously)
```

### The Handoff Discipline

The critical moment is **the end of a chat session**. The quality of the handoff determines whether Claude Code (or the next chat session) can work effectively.

**Good handoff (in progress.md):**
```
### Next Session Priorities
1. **Shape text clipping on lpm-slides-v1.html slide 8** — The "ask-number" 
   divs (large "1", "2", "3" numerals) are clipping. Root cause: the 
   shape text path doesn't account for vertical centering when font size 
   is large relative to shape height. Fix in extractor: when shapeStyle 
   is set, compare fontSize to shape height and adjust valign/margin.
```

**Bad handoff:**
```
### Next Session Priorities  
1. Fix text clipping issues
```

The good version gives Claude Code the specific fixture, the specific element, the diagnosed root cause, and the approach. Claude Code can execute this without needing a conversation.

## When to Use Chat vs Claude Code

| Activity | Chat | Claude Code |
|----------|------|-------------|
| "Why is this rendering wrong?" | ✓ | |
| "What approach should we take?" | ✓ | |
| "Apply this agreed fix to extractor.js" | | ✓ |
| "Run against all fixtures, report results" | | ✓ |
| "Should we add table support? How?" | ✓ | |
| "Implement table extraction per the design in progress.md" | | ✓ |
| "Review this screenshot — what's wrong?" | ✓ | |
| "Update progress.md with session decisions" | ✓ | |
| "Add a new test fixture for this HTML pattern" | | ✓ |
| "This design pattern conflicts with our principles — discuss" | ✓ | |

**Rule of thumb:** If the task requires judgement, diagnosis, or deciding between options → chat. If the task is executing an agreed approach → Claude Code.

## Bootstrapping for a New Project

1. Start with a chat session to establish goals, architecture, and principles
2. Produce `progress.md` with initial structure, phases, and first priorities
3. Produce `CLAUDE.md` with project structure, rules, and conventions
4. Optionally produce `project-context.md` if strategic context is complex
5. Commit all three to the repo
6. From here on: chat for thinking, Claude Code for doing

## Evolving the Pattern

This workflow should feel lightweight, not bureaucratic. If maintaining the files feels like overhead, simplify:
- Small/focused projects: `CLAUDE.md` + `progress.md` is enough
- Solo exploration: just `progress.md` as a scratchpad is fine
- Large team projects: add `project-context.md` and consider splitting `progress.md` by workstream

The pattern works because it makes the *handoff* explicit. Without it, context lives in your head or buried in chat history. With it, either Claude instance (chat or Code) can pick up where the other left off.
