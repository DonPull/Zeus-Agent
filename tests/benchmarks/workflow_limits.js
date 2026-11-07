/** Aggregate budgets survive a controlled process restart. */
export function remainingAllowance(limits,spent,elapsed){
  if(!spent?.usage||spent.usage.unknown_requests!==0||!Number.isInteger(spent.evaluation?.directives))throw Error('Restart requires complete usage/directive evidence');
  const requests=limits.max_requests-spent.usage.requests,tokens=limits.max_tokens-spent.usage.known_tokens,directives=limits.max_directives-spent.evaluation.directives,wall=limits.wall_time_ms-elapsed;
  if(requests<1||tokens<1||directives<1||wall<1)throw Error('Aggregate workflow allowance exhausted before restart');
  return {...limits,max_requests:requests,max_tokens:tokens,max_directives:directives,max_in_flight:Math.min(limits.max_in_flight,requests),max_output_tokens:Math.min(limits.max_output_tokens,tokens),wall_time_ms:wall};
}
