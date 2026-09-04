# CSE476 CA1 Project 1: Autonomous Problem Solver Agent

**Course:** CSE476 Agentic AI and Intelligent Automation  
**Student Name:** Anmol Nagpal  
**Submission Type:** Solo Submission  
**Maximum Marks:** 30  

---

### Project Overview (Three Required Paragraphs)

**1. Tools Used (`fetch_problem_spec` and `execute_code_sandbox`):**  
Our agent operates two primary functional tools to act on coding challenges rather than merely generating text. The first tool, `fetch_problem_spec(query)`, queries LeetCode problem specifications, parsing the formal title, constraints, and test cases (using an online GraphQL client with an offline catalog fallback). The second tool, `execute_code_sandbox(code, testcases, language)`, compiles and executes the candidate solution inside an isolated execution environment, verifying stdout, assertion correctness, and execution runtime against each test case before returning a formal verification verdict.

**2. What the Memory Does:**  
The agent features a dual-layer memory system implemented in `memory.py` comprising conversational history and an active working state buffer. The conversational memory records past dialogue turns, while the working state tracks the current problem ID, target programming language, and verification status. In multi-turn dialogues, when the user asks ambiguous follow-up requests (such as *"recommend a follow-up problem using a similar concept in C++"*), the agent reads back its memory of the previous turn (*"Two Sum in Python"*) to resolve entity references and maintain continuity without requiring repetitive user prompts.

**3. One Honest Failure Hit and How We Handled It:**  
During initial development, our agent frequently produced code that appeared syntactically valid but failed edge cases or timed out on non-adjacent inputs (for example, generating a naive adjacent-element search for Two Sum which failed when matching pairs were separated across the array). Rather than allowing the agent to fail silently or output an unverified answer like a conventional chatbot, we incorporated a dynamic ReAct self-healing feedback loop. When `execute_code_sandbox` observes a `Wrong Answer` or test failure, the agent catches the failure observation, inspects the failed test case, diagnoses the algorithmic flaw, synthesizes an optimal Hash Map approach, and autonomously triggers a second sandbox execution to achieve 100% test pass verification.

---

### 🎓 Viva Reference Guide (10 Marks)

| Viva Question | Exact Code Location | Walkthrough Explanation |
|---|---|---|
| **1. Where does the plan-act loop decide the next step?** | `agent.py: lines 185–260` | The `run()` method maintains a step counter and loop state. After calling each tool, it checks `observation.get("status")`. If the status is not `"PASSED"`, it branches into the self-correction block to refine the code and re-test instead of exiting. |
| **2. Walk through a tool call.** | `agent.py: lines 211–220` $\rightarrow$ `tools.py: lines 140–235` | The agent prepares `tool_args` (code, testcases, language) and calls `self.tools["execute_code_sandbox"]["fn"](**tool_args)`. The tool executes the solution in an isolated dictionary scope (`exec`), feeds each test input, compares actual vs expected output, and records execution time. |
| **3. Show where memory is read back.** | `agent.py: lines 168–180` $\rightarrow$ `memory.py: lines 65–85` | In `agent.py`, `_extract_intent_and_entities()` and `run()` call `self.memory.get_recent_history()` and `self.memory.get("last_problem_id")`. This resolves pronouns like *"this problem"* or *"follow-up"* back to the problem stored in previous turns. |

---

### How to Run the Demo

**Option A: Run the Jupyter Notebook**
```bash
jupyter notebook demo.ipynb
```
*(Open `demo.ipynb` and click **Run All**)*

**Option B: Run the Command-Line Demo (Zero Dependencies)**
```bash
python run_demo.py
```
