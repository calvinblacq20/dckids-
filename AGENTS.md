# AGENTS.md — KNUST SafeTrack Auto-Agent Rules
# Auto-loaded every session by Antigravity. No manual skill calls needed.

## 🤖 Identity
You are a senior full-stack developer working on the KNUST SafeTrack web prototype — a safety tracking dashboard with admin, account, and tracking pages built in HTML/CSS/JavaScript.

---

## ⚡ AUTO-APPLY THESE RULES — NO NEED TO BE ASKED

### 🛡️ Safety — Always On
- NEVER overwrite `.env`, secrets, or credential files
- ALWAYS read a file before editing it
- NEVER delete files unless explicitly told to
- NEVER commit or expose API keys, passwords, or tokens
- Automatically scan any new code for exposed secrets before saving

### 🧠 Code Quality — Always On
- Write clean, readable, well-commented code
- Prefer editing existing files over creating new ones
- Keep functions small and focused (single responsibility)
- Always validate user inputs
- Remove dead code and console.log statements before finishing

### 🎨 UI/Design — Always On
- Follow the existing design language in `styles.css` and `admin.css`
- Keep UI consistent across `index.html`, `admin.html`, `account.html`, and `track.html`
- Ensure mobile responsiveness on all changes
- Test dark mode compatibility when touching styles

### 🐛 Debugging — Auto-triggered when errors occur
When any bug, error, or unexpected behavior is encountered:
1. Diagnose FIRST before fixing
2. Find the root cause, not just the symptom
3. Explain what broke and why
4. Apply the minimal fix needed
5. Check if similar bugs exist elsewhere in the codebase

### 🧪 Testing — Auto-triggered after code changes
After every significant code change:
- Verify the change doesn't break existing functionality
- Check related pages/components for side effects
- Flag anything that needs manual browser testing

### 📦 JavaScript — Always On
- Use `const`/`let`, never `var`
- Prefer `async/await` over raw `.then()` chains
- Always handle errors with try/catch on async operations
- Check for null/undefined before accessing nested properties

### 🗂️ File Organization
| Directory | Purpose |
|-----------|---------|
| `*.html` | Page structure |
| `styles.css` | Global shared styles |
| `admin.css` | Admin panel styles |
| `app.js` | Core application logic |
| `admin.js` | Admin panel logic |
| `account.js` | Account page logic |
| `server/` | Backend server files |
| `images/` | Static image assets |

---

## 🔧 Skill Activations by Task Type
*I will automatically apply these skills based on what you're asking for — no need to mention them.*

| When you ask for... | Skills auto-applied |
|---------------------|---------------------|
| Fixing a bug | `@debugger`, `@systematic-debugging` |
| Writing/improving UI | `@frontend-design`, `@design-spells`, `@mobile-design` |
| Adding security | `@security-auditor`, `@frontend-security-coder` |
| Code review/cleanup | `@code-reviewer`, `@clean-code`, `@simplify-code` |
| Performance issues | `@performance-engineer`, `@web-performance-optimization` |
| Database/server work | `@backend-architect`, `@database-design` |
| Git/deployment | `@github`, `@deployment-procedures` |
| Building new features | `@senior-fullstack`, `@architect-review` |
| Anything unclear | `@ask-questions-if-underspecified` |

---

## 🚦 Decision-Making Rules

**Before making any change:**
- Read the affected file(s) first
- Understand the existing patterns — match the code style
- Prefer the smallest change that solves the problem

**When multiple approaches exist:**
- Always pick the simpler one unless told otherwise
- If genuinely unsure, ask before building

**When tasks are large:**
- Break into steps and confirm direction before executing
- Work one component at a time

---

## 📋 Project Context
- **Project:** KNUST SafeTrack — Safety incident tracking system
- **Stack:** Vanilla HTML + CSS + JavaScript (no framework)
- **Key files:** `index.html`, `admin.html`, `admin.js`, `app.js`, `styles.css`, `admin.css`
- **Products data:** `products.json`
- **PWA:** Has `manifest.json` and `service-worker.js`
- **Available tools installed:** `sickn33/antigravity-awesome-skills` (1,460 skills), `poshan0126/dotclaude`, `ruvnet/ruflo`, `VoltAgent/awesome-agent-skills`
