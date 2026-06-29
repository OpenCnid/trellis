import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI();

const EntitySchema = z.object({
  id: z.string().describe("A unique UUID for this entity"),
  name: z.string().describe("The extracted name of the entity"),
  type: z.string().describe("The type of entity (e.g., Person, Organization, Concept)"),
  sourceNodeIds: z.array(z.string()).describe("MUST contain the exact AST Node ID provided in the prompt")
});

const ActionSchema = z.object({
  id: z.string().describe("A unique UUID for this action"),
  subjectId: z.string().describe("The UUID of the subject Entity"),
  verb: z.string().describe("The relationship or action verb"),
  objectId: z.string().describe("The UUID of the object Entity"),
  sourceNodeIds: z.array(z.string()).describe("MUST contain the exact AST Node ID provided in the prompt")
});

const GraphSchema = z.object({
  entities: z.array(EntitySchema),
  actions: z.array(ActionSchema)
});

async function runLlmPoc() {
  const mockText = "Microsoft acquired GitHub for $7.5 billion.";
  const mockAstNodeId = "5e0278c2a733906f136854f0503056f457030fc6a098045a8500e8685d9f018c";

  const prompt = `Extract the entities and actions from the following text. You must map the provided AST Node ID to the 'sourceNodeIds' array of every entity and action you extract.

Text: ${mockText}
AST Node ID: ${mockAstNodeId}`;

  console.log("Sending prompt to LLM...");
  console.log("========================================");
  console.log(prompt);
  console.log("========================================\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini-2026-03-17",
      messages: [
        { role: "system", content: "You are an expert GraphRAG extraction engine. You strictly follow schemas and perfectly carry over source metadata IDs." },
        { role: "user", content: prompt }
      ],
      response_format: zodResponseFormat(GraphSchema, "graph_extraction"),
      temperature: 0.1, // Low temperature for deterministic mapping
    });

    const rawContent = completion.choices[0].message.content;
    
    if (!rawContent) {
      console.error("LLM failed to return content.");
      return;
    }

    const result = JSON.parse(rawContent);

    console.log("LLM Structured Output:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n--- Validation Checklist ---");
    
    // 1. Zod schema validation (implicitly handled by .parse, but we can double check)
    const zodValidation = GraphSchema.safeParse(result);
    console.log(`1. JSON conforms to GraphSchema without errors? ${zodValidation.success}`);

    // 2. Identify Microsoft and GitHub
    const entityNames = result.entities.map(e => e.name.toLowerCase());
    const hasMicrosoft = entityNames.includes("microsoft");
    const hasGitHub = entityNames.includes("github");
    console.log(`2. Accurately identified 'Microsoft' and 'GitHub'? ${hasMicrosoft && hasGitHub}`);

    // 3. Ultimate Check: sourceNodeIds tracking
    const microsoftEntity = result.entities.find(e => e.name.toLowerCase() === "microsoft");
    const githubEntity = result.entities.find(e => e.name.toLowerCase() === "github");
    const acquiredAction = result.actions.find(a => a.verb.toLowerCase().includes("acquire"));
    
    const microsoftValid = microsoftEntity?.sourceNodeIds.includes(mockAstNodeId) ?? false;
    const githubValid = githubEntity?.sourceNodeIds.includes(mockAstNodeId) ?? false;
    const actionValid = acquiredAction?.sourceNodeIds.includes(mockAstNodeId) ?? false;
    const allValid = microsoftValid && githubValid && actionValid;

    console.log(`3. The Ultimate Check: Did the LLM perfectly map the sourceNodeId (${mockAstNodeId})?`);
    console.log(`   - To the 'Microsoft' entity? ${microsoftValid}`);
    console.log(`   - To the 'GitHub' entity? ${githubValid}`);
    console.log(`   - To the 'acquired' action? ${actionValid}`);
    console.log(`\nOverall Success: ${zodValidation.success && hasMicrosoft && hasGitHub && allValid ? 'PASS' : 'FAIL'}`);

  } catch (error) {
    console.error("Failed to run LLM PoC:", error);
  }
}

runLlmPoc().catch(console.error);
