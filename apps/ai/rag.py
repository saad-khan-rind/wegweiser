from typing import Dict, List, Any
from vectorstore import VectorStore  # Assumes standard local retrieval implementation
from llm import call_llm

class LegalRAG:
    def __init__(self):
        self.vector_store = VectorStore()

    def _build_system_prompt(self, context_chunks: List[str]) -> str:
        aggregated_context = "\n\n--- DOCUMENT CHUNK ---\n".join(context_chunks)
        
        return f"""
        You are Wegweiser, an expert AI legal assistant specializing in German immigration law (AufenthG, BeschV) and administrative procedures.
        Your task is to analyze the user's query against the provided primary legal source materials.

        PRIMARY SOURCE MATERIALS:
        {aggregated_context}

        CRITICAL EXECUTION RULES:
        1. Avoid superficial text matching. Deduce implicit permissions from legal exclusions. For instance, if the text states "Blue Card holders are restricted to employment matching their degree qualifications," deduce that independent freelance initialization requires explicit variance or accessory approval.
        2. Curing the "I Don't Know" paradox: Never state "I do not know" if the provided text outlines the high-level framework, authority responsibilities, or partial pathways. Instead, deliver the explicit framework found in the source text and clearly define what remains outside the text's scope.
        3. Maintain absolute semantic loyalty to paragraph requirements (§), timelines, and monetary figures mentioned. Do not invent details outside the text.
        """

    def retrieve_and_generate(self, optimized_query: str) -> Dict[str, Any]:
        # Retrieve rich parent chunks along with alphanumeric identifiers
        retrieved_docs = self.vector_store.similarity_search(optimized_query, k=5)
        
        context_chunks = []
        citations = []
        
        for idx, doc in enumerate(retrieved_docs):
            # Capture file origin and specific statutory paragraph parameters if present
            source_name = doc.metadata.get("source", f"Document {idx+1}")
            paragraph = doc.metadata.get("paragraph", "")
            citation_label = f"{source_name} {paragraph}".strip()
            
            context_chunks.append(f"[{citation_label}]: {doc.page_content}")
            citations.append({
                "id": idx + 1,
                "label": citation_label,
                "text_snippet": doc.page_content[:200] + "..."
            })

        system_prompt = self._build_system_prompt(context_chunks)
        user_prompt = f"Query: {optimized_query}\nProvide a comprehensive, structural answer based on the legal frameworks above:"
        
        # Execute synthesis call
        generated_answer = call_llm(user_prompt, system_message=system_prompt)

        return {
            "answer": generated_answer,
            "citations": citations
        }