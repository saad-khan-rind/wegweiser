import json
from typing import Dict, List, Any, Tuple
from llm import call_llm
from rag import LegalRAG

class GoalBasedAgent:
    def __init__(self):
        self.rag = LegalRAG()
        # Define standard slots required for typical German immigration tracks
        self.GOAL_SLOTS = {
            "blue_card": ["degree_recognized", "job_offer_salary", "contract_provided"],
            "skilled_worker": ["vocational_or_academic_degree", "german_level", "job_match"],
            "student_visa": ["admission_letter", "blocked_account_or_sponsor", "health_insurance"],
            "family_reunification": ["spouse_permit_type", "housing_space_sqm", "spouse_language_level"]
        }

    def _rewrite_query(self, current_message: str, history: List[Dict[str, str]]) -> str:
        """
        Fixes Context Amnesia by condensing the entire chat history 
        and the latest turn into a standalone legal query.
        """
        if not history:
            return current_message

        history_str = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in history[-4:]])
        
        rewrite_prompt = f"""
        You are a German legal architecture pre-processor. Given the following conversation history and a follow-up question, rephrase the follow-up question into a single standalone search query. 
        The rewritten query MUST retain all critical legal nouns, paragraph references (e.g., AufenthG, § 18b), permit types, and the underlying objective. Do not answer the question, only rewrite it.

        CONVERSATION HISTORY:
        {history_str}

        FOLLOW-UP QUESTION:
        {current_message}

        STANDALONE QUERY:
        """
        standalone_query = call_llm(rewrite_prompt, temperature=0.0).strip()
        return standalone_query if standalone_query else current_message

    def _determine_goal_and_slots(self, current_message: str, history: List[Dict[str, str]]) -> Tuple[str, Dict[str, Any]]:
        """
        Analyzes the conversation to identify the user's primary immigration or legal goal
        and evaluates which data slots have been successfully filled.
        """
        full_context = "\n".join([f"{m['role']}: {m['content']}" for m in history[-2:]]) + f"\nuser: {current_message}"
        
        analysis_prompt = f"""
        Analyze the conversation context below and extract the active immigration goal and any filled parameter slots.
        Available Goals: {list(self.GOAL_SLOTS.keys())}

        CONTEXT:
        {full_context}

        Output valid JSON only with keys "active_goal" (string or null) and "extracted_slots" (dictionary of property: value or null).
        JSON:
        """
        try:
            analysis_raw = call_llm(analysis_prompt, json_mode=True)
            analysis_data = json.loads(analysis_raw)
            return analysis_data.get("active_goal"), analysis_data.get("extracted_slots", {})
        except Exception:
            return None, {}

    def handle_message(self, current_message: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Orchestrates the goal-driven interaction loop.
        """
        # Step 1: Mitigate amnesia by generating a contextual standalone search term
        standalone_query = self._rewrite_query(current_message, history)
        
        # Step 2: Evaluate state machines/slots
        active_goal, extracted_slots = self._determine_goal_and_slots(current_message, history)
        
        # Step 3: Run advanced RAG pipeline using the standalone query
        rag_payload = self.rag.retrieve_and_generate(standalone_query)
        
        # Step 4: Run Agentic verification layer to verify missing slot alerts
        missing_slots = []
        if active_goal and active_goal in self.GOAL_SLOTS:
            required = self.GOAL_SLOTS[active_goal]
            missing_slots = [slot for slot in required if slot not in extracted_slots or extracted_slots[slot] is None]

        # Combine RAG insights with goal guidance if slots are missing
        final_response = rag_payload["answer"]
        if missing_slots:
            friendly_names = [s.replace("_", " ") for s in missing_slots]
            final_response += f"\n\n*To provide precise legal certainty regarding your goal, it would also be helpful to clarify your status regarding: {', '.join(friendly_names)}.*"

        return {
            "answer": final_response,
            "citations": rag_payload["citations"],
            "standalone_query": standalone_query,
            "active_goal": active_goal,
            "missing_slots": missing_slots
        }