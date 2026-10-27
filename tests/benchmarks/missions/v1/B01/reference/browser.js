/** Runs a known UI solution, never Zeus. The observation is evaluator-owned. */
export async function updateTicketThroughBrowser(page, portal, { search = true } = {}) {
  await page.goto(portal.url);
  if (search) await page.getByRole('textbox', { name: 'Search customer, ticket or subject' }).fill('C-204');
  const ticket=page.locator('[data-ticket-id="T-102"]');
  await ticket.getByRole('combobox', { name: 'Priority' }).selectOption('high');
  await ticket.getByRole('textbox', { name: 'New note' }).fill('Call after 16:00 Sofia time.');
  const response=page.waitForResponse(response=>response.url()===portal.url+'/api/tickets/T-102'&&response.request().method()==='PATCH');
  await ticket.getByRole('button', { name: 'Save ticket' }).click();
  const saved=await response;
  if(!saved.ok()) throw new Error('Reference UI update failed');
  // The browser observation binds its real PATCH response to the controller's
  // mutation journal; an actor-supplied report or an unconsumed CDP body is not needed.
  const mutation=portal.snapshot().mutations.at(-1);
  const sent=saved.request().postDataJSON();
  if(mutation?.id!=='T-102'||sent.priority!==mutation.priority||sent.note!==mutation.note) throw new Error('Browser request and server mutation disagree');
  return {source:'playwright-controller',portal_identity:portal.identity,ticket_id:'T-102',audit_seq:mutation.seq};
}
