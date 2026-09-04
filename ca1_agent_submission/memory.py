# ca1_agent_submission/memory.py
"""
CSE476 Agentic AI and Intelligent Automation - CA1 Project 1
Module: Memory
Description:
    Provides both conversational memory (recording past dialogue turns)
    and working memory (key-value state store tracking problem context,
    active algorithms, tested code, and user preferences).
"""

from typing import Dict, Any, List, Optional
import time


class ConversationTurn:
    def __init__(self, user_input: str, agent_output: str, steps_taken: int, metadata: Optional[Dict[str, Any]] = None):
        self.user_input = user_input
        self.agent_output = agent_output
        self.steps_taken = steps_taken
        self.metadata = metadata or {}
        self.timestamp = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_input": self.user_input,
            "agent_output": self.agent_output,
            "steps_taken": self.steps_taken,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }


class AgentMemory:
    """
    Episodic & Working Memory for the Agent.
    Remembers:
      1. Earlier conversation turns (chat history).
      2. Problem context (active problem, target language, verified solutions).
      3. Failure logs and retry counts across turns.
    """
    def __init__(self):
        self.turns: List[ConversationTurn] = []
        self.working_state: Dict[str, Any] = {
            "last_problem_id": None,
            "last_problem_name": None,
            "last_language": "python",
            "last_algorithm": None,
            "solved_problems": [],
            "user_preferences": {}
        }

    def record_turn(self, user_input: str, agent_output: str, steps_taken: int, metadata: Optional[Dict[str, Any]] = None):
        """Records a completed dialogue turn into episodic memory."""
        turn = ConversationTurn(user_input, agent_output, steps_taken, metadata)
        self.turns.append(turn)

        # Update working state from metadata if available
        if metadata:
            for key, val in metadata.items():
                if val is not None:
                    self.working_state[key] = val

    def set(self, key: str, value: Any):
        """Sets a value in working memory."""
        self.working_state[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        """Retrieves a value from working memory."""
        return self.working_state.get(key, default)

    def get_recent_history(self, limit: int = 3) -> str:
        """
        Formats recent turns into a concise context block for the plan-act loop.
        Viva Anchor: This is where memory is read back into the decision cycle.
        """
        if not self.turns:
            return "No previous conversation turns."

        recent = self.turns[-limit:]
        history_lines = []
        for idx, turn in enumerate(recent, 1):
            history_lines.append(f"Turn {idx}:")
            history_lines.append(f"  User: {turn.user_input}")
            # Truncate output preview to keep memory compact
            preview = turn.agent_output[:120] + "..." if len(turn.agent_output) > 120 else turn.agent_output
            history_lines.append(f"  Agent: {preview}")
            if turn.metadata.get("last_problem_name"):
                history_lines.append(f"  Context: Problem='{turn.metadata.get('last_problem_name')}', Lang='{turn.metadata.get('last_language')}'")
        return "\n".join(history_lines)

    def get_working_state_summary(self) -> str:
        """Summarizes key state variables currently retained in working memory."""
        items = []
        for k, v in self.working_state.items():
            if v is not None and v != [] and v != {}:
                items.append(f"{k}: {v}")
        return ", ".join(items) if items else "Empty working state"

    def clear(self):
        """Resets both episodic and working memory."""
        self.turns.clear()
        self.working_state.clear()
