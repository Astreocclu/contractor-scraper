/**
 * A/B Council Runner
 * Runs the council with injectable prompts, returns results without DB side effects.
 */

const {
  callAzureGPT,
  callGeminiFairArbiter,
  callDeepSeekScorer,
  callClaudeJudge,
  callDeepSeekR1Judge
} = require('./council_callers');

const { COUNCIL_CONFIG } = require('./deep_investigation/constants');

const JUDGE_PROMPT = `You are the final judge for contractor Trust Scores. Three models evaluated this contractor from different perspectives:

- Consumer Advocate (skeptical): {{gpt_response}}
- Fair Arbiter (charitable): {{gemini_response}}
- Independent Scorer (objective): {{deepseek_response}}

Deep Investigation also found these flags: {{flags}}

Synthesize their perspectives. Where they agree, that's strong signal. Where they diverge, read their reasoning and decide what's true.

Respond with json only:
{
  "final_score": <0-100>,
  "confidence": "HIGH/MEDIUM/LOW",
  "council_agreed_on": "<what all three saw>",
  "council_diverged_on": "<disagreements and how you resolved>",
  "reasoning": "<your synthesis>",
  "human_review_needed": <true/false>,
  "review_reason": "<if true, why>"
}`;

class ABCouncilRunner {
  constructor(promptSet) {
    this.promptSet = promptSet;
    this.totalCost = 0;
  }

  async run(enrichedData, flags = []) {
    const flagsJson = JSON.stringify(flags, null, 2);

    // Build prompts with data
    const advocatePrompt = this.promptSet.CONSUMER_ADVOCATE_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    const arbiterPrompt = this.promptSet.FAIR_ARBITER_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    const scorerPrompt = this.promptSet.INDEPENDENT_SCORER_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    // Run council in parallel
    const [advocateResult, arbiterResult, scorerResult] = await Promise.allSettled([
      callAzureGPT(advocatePrompt),
      callGeminiFairArbiter(arbiterPrompt),
      callDeepSeekScorer(scorerPrompt)
    ]);

    const councilResponses = {};
    let successCount = 0;

    if (advocateResult.status === 'fulfilled' && !advocateResult.value.skipped) {
      councilResponses.consumer_advocate = advocateResult.value.result;
      this.totalCost += advocateResult.value.usage.cost;
      successCount++;
    }

    if (arbiterResult.status === 'fulfilled' && !arbiterResult.value.skipped) {
      councilResponses.fair_arbiter = arbiterResult.value.result;
      this.totalCost += arbiterResult.value.usage.cost;
      successCount++;
    }

    if (scorerResult.status === 'fulfilled' && !scorerResult.value.skipped) {
      councilResponses.independent_scorer = scorerResult.value.result;
      this.totalCost += scorerResult.value.usage.cost;
      successCount++;
    }

    if (successCount < 2) {
      return {
        error: 'Not enough council members responded',
        successCount,
        councilResponses
      };
    }

    // Run judge
    const judgePrompt = JUDGE_PROMPT
      .replace('{{gpt_response}}', JSON.stringify(councilResponses.consumer_advocate || {}, null, 2))
      .replace('{{gemini_response}}', JSON.stringify(councilResponses.fair_arbiter || {}, null, 2))
      .replace('{{deepseek_response}}', JSON.stringify(councilResponses.independent_scorer || {}, null, 2))
      .replace('{{flags}}', flagsJson);

    let judgeResult;
    try {
      const response = await callClaudeJudge(judgePrompt);
      this.totalCost += response.usage.cost;
      judgeResult = response.result;
    } catch (e) {
      // Fallback to DeepSeek R1
      const response = await callDeepSeekR1Judge(judgePrompt);
      this.totalCost += response.usage.cost;
      judgeResult = response.result;
    }

    return {
      score: judgeResult.final_score,
      confidence: judgeResult.confidence,
      reasoning: judgeResult.reasoning,
      council_scores: {
        advocate: councilResponses.consumer_advocate?.score,
        arbiter: councilResponses.fair_arbiter?.score,
        scorer: councilResponses.independent_scorer?.score
      },
      cost: this.totalCost,
      promptSet: this.promptSet.name
    };
  }
}

module.exports = { ABCouncilRunner };
