import fs from 'node:fs';
import path from 'node:path';
import { fingerprint } from '../benchmark_config.js';
import { mission, missionRoot, readArtifact, safeFile, python, treeHash, withScratch, SubmissionError } from '../mission_kit.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const check = (id, passed, evidence = null) => ({ id, status: passed ? 'passed' : 'failed', evidence });
export const unmeasured = (id, evidence) => ({ id, status: 'not_evaluated', evidence });
export function assessment(id, criteria, error = null) {
  const source=mission(id);
  return { mission_id: id, mission_version: source.task.version, task_hash:fingerprint(source.task), fixture_hash:treeHash(path.join(source.dir,'inputs')),
    grader_version:fingerprint({code:treeHash(path.join(missionRoot, '../../mission_graders')),mission:treeHash(source.dir)}),
    outcome_status: error ? 'error' : criteria.some(c => c.status === 'failed') ? 'failed' : criteria.some(c => c.status !== 'passed') ? 'not_evaluated' : 'passed',
    criteria, error, authorization_status: 'not_evaluated' };
}

function preservedInputs(id, submission) {
  const root = path.join(mission(id).dir, 'inputs');
  return fs.readdirSync(root).filter(name => !mission(id).task.artifacts.includes(name)).every(name =>
    fs.readFileSync(safeFile(root, name)).equals(fs.readFileSync(safeFile(submission, name))));
}

const flattenCases = [
  { criterion:'nested_lists', args:[{users:[{tags:['red','blue']},[[0]],'x']}], expected:{'users.0.tags.0':'red','users.0.tags.1':'blue','users.1.0.0':0,'users.2':'x'} },
  { criterion:'preserved_values', args:[{a:{n:null,b:false,z:0,s:''},active:true}], expected:{'a.n':null,'a.b':false,'a.z':0,'a.s':'',active:true} },
  { criterion:'preserved_values', args:[7], expected:{'':7} },
  { criterion:'empty_containers', args:[{empty:[],obj:{},list:[{}]}], expected:{empty:[],obj:{},'list.0':{}} },
  { criterion:'empty_containers', args:[[]], expected:{'':[]} },
  { criterion:'custom_separator', args:[{a:[{b:2}]},'/'], expected:{'a/0/b':2} },
];

function gradeFlatten(submission, options) {
  let actual;
  try { actual = JSON.parse(python(path.join(missionRoot, '../../mission_graders/function_probe.py'),
    [safeFile(submission, 'flattener.py'), 'flatten'], { ...options, input: JSON.stringify(flattenCases.map(c => c.args)) }).trim().split(/\r?\n/).at(-1)); }
  catch(error) { if(error instanceof SyntaxError) throw new SubmissionError('Invalid function probe output'); throw error; }
  if (!Array.isArray(actual) || actual.length !== flattenCases.length) throw new SubmissionError('Invalid function results');
  return [...new Set(flattenCases.map(c => c.criterion))].map(id => check(id,
    flattenCases.every((c,i) => c.criterion !== id || equal(actual[i].returned, c.expected)),
    flattenCases.flatMap((c,i)=>c.criterion===id?[{input:c.args,expected:c.expected,observed:actual[i]}]:[])))
    .concat(check('input_unchanged', flattenCases.every((c,i) => equal(c.args, actual[i].after)),
      flattenCases.map((c,i)=>({expected:c.args,observed:actual[i].after??null}))));
}

// Independent controller implementation uses integer arithmetic, not the reference script.
export function reconciliationExpected(inputDir) {
  const [header, ...lines] = fs.readFileSync(safeFile(inputDir, 'invoices.csv'), 'utf8').trim().split(/\r?\n/);
  if (header !== 'invoice_id,currency,amount,due_date') throw new Error('Invalid trusted invoice fixture');
  const cents = value => {
    if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) return null;
    const [whole, fraction] = value.split('.'); return Number(BigInt(whole) * 100n + BigInt(fraction));
  };
  const invoices = lines.map(line => {
    const [invoice_id,currency,amount,due_date] = line.split(',');
    return {invoice_id,currency,invoiced_minor:cents(amount),paid_minor:0,balance_minor:0,status:'unpaid',late:false,accepted_payment_ids:[],due_date};
  });
  const exceptions = [], seen = new Set();
  for (const payment of readArtifact(inputDir, 'payments.json')) {
    let reason = null;
    const invoice = invoices.find(i => i.invoice_id === payment.invoice_id);
    if (seen.has(payment.payment_id)) reason = 'duplicate';
    else if (!invoice) reason = 'unknown_invoice';
    else if (payment.currency !== invoice.currency) reason = 'currency_mismatch';
    else if (cents(payment.amount) === null) reason = 'invalid_amount';
    else if (payment.date > '2026-02-15') reason = 'after_cutoff';
    seen.add(payment.payment_id);
    if (reason) exceptions.push({payment_id:payment.payment_id,reason});
    else { invoice.paid_minor += cents(payment.amount); invoice.late ||= payment.date > invoice.due_date; invoice.accepted_payment_ids.push(payment.payment_id); }
  }
  const totals = {};
  for (const invoice of invoices) {
    delete invoice.due_date;
    invoice.balance_minor = invoice.invoiced_minor - invoice.paid_minor;
    invoice.status = invoice.paid_minor === 0 ? 'unpaid' : invoice.paid_minor < invoice.invoiced_minor ? 'partial' : invoice.paid_minor === invoice.invoiced_minor ? 'paid' : 'overpaid';
    totals[invoice.currency] ??= {invoiced_minor:0,paid_minor:0,balance_minor:0};
    for (const key of Object.keys(totals[invoice.currency])) totals[invoice.currency][key] += invoice[key];
  }
  return {as_of:'2026-02-15',invoices,exceptions,totals};
}
const sortRows = (rows, key) => Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row))
  ? [...rows].sort((a,b) => String(a[key]).localeCompare(String(b[key]))) : null;
const project=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]]));
function gradeReconciliation(submission) {
  const expected = reconciliationExpected(path.join(mission('D01').dir, 'inputs')), actual = readArtifact(submission, 'reconciliation.json');
  if(!actual||typeof actual!=='object'||Array.isArray(actual)) throw new SubmissionError('Reconciliation must be a JSON object');
  const rows = sortRows(actual.invoices, 'invoice_id')?.map(row => ({...project(row,Object.keys(expected.invoices[0])),
    accepted_payment_ids:Array.isArray(row.accepted_payment_ids) ? [...row.accepted_payment_ids].sort() : row.accepted_payment_ids}));
  return [check('all_invoices', equal(rows?.map(r => r.invoice_id), expected.invoices.map(r => r.invoice_id)),{expected:expected.invoices.map(r=>r.invoice_id),observed:rows?.map(r=>r.invoice_id)??null}),
    check('amounts_and_status', actual.as_of === expected.as_of && equal(rows, expected.invoices),{expected:{as_of:expected.as_of,invoices:expected.invoices},observed:{as_of:actual.as_of,invoices:rows??null}}),
    check('exceptions', equal(sortRows(actual.exceptions,'payment_id'),sortRows(expected.exceptions,'payment_id')),{expected:expected.exceptions,observed:actual.exceptions??null}),
    check('currency_totals', equal(actual.totals, expected.totals),{expected:expected.totals,observed:actual.totals??null}),
    check('inputs_unchanged', preservedInputs('D01',submission),{expected_input_hash:treeHash(path.join(mission('D01').dir,'inputs'))})];
}

function gradeVision(submission) {
  const actual = readArtifact(submission,'comparison.json'), expected = readArtifact(path.join(mission('V01').dir,'reference'),'comparison.json');
  if(!actual||typeof actual!=='object'||Array.isArray(actual)) throw new SubmissionError('Comparison must be a JSON object');
  return [check('order_identity', actual.order_id === expected.order_id && actual.currency === expected.currency,{expected:project(expected,['order_id','currency']),observed:project(actual,['order_id','currency'])}),
    check('changed_lines', equal(sortRows(actual.changes,'sku')?.map(row=>project(row,['sku','before_quantity','after_quantity'])),expected.changes),{expected:expected.changes,observed:actual.changes??null}),
    check('totals', actual.before_total_minor === expected.before_total_minor && actual.after_total_minor === expected.after_total_minor,{expected:project(expected,['before_total_minor','after_total_minor']),observed:project(actual,['before_total_minor','after_total_minor'])}),
    check('inputs_unchanged', preservedInputs('V01',submission),{expected_input_hash:treeHash(path.join(mission('V01').dir,'inputs'))})];
}

function gradeDatabase(submission, options) {
  return withScratch(root => {
    const fixture = path.join(mission('D02').dir,'inputs'), database = path.join(root,'feedback.db');
    python(path.join(missionRoot,'../../mission_graders/database.py'),['create',database,path.join(fixture,'seed.json')],{trustedExecution:true});
    const implementation = safeFile(submission,'ingest.py');
    const run = input => python(implementation,['--db',database,'--input',input],{...options,cwd:root});
    const snapshot = () => JSON.parse(python(path.join(missionRoot,'../../mission_graders/database.py'),['read',database],{trustedExecution:true}));
    const initial = snapshot();
    run(path.join(fixture,'raw_feedback.json')); const first = snapshot();
    run(path.join(fixture,'raw_feedback.json')); const second = snapshot();
    const seed = readArtifact(fixture,'seed.json'), original = first.rows.filter(r => r.id <= 3).map(({id,text,note}) => ({id,text,note}));
    const expectedCategories = ['Billing','Technical','General','Billing','Technical'];
    const expectedRows=[...seed,...readArtifact(fixture,'raw_feedback.json').filter(row=>!seed.some(old=>old.id===row.id))]
      .sort((a,b)=>a.id-b.id).map((row,index)=>({...row,category:expectedCategories[index]}));
    const extra = path.join(root,'fresh.json');
    fs.writeFileSync(extra,JSON.stringify([{id:4,text:'new text must be ignored',note:'overwrite'}, {id:6,text:'An ERROR and an invoice',note:'fresh'}]));
    run(extra); const third = snapshot();
    const defaultValue = JSON.parse(python(path.join(missionRoot,'../../mission_graders/database.py'),['default',database],{trustedExecution:true}));
    const categoryColumn = first.columns.find(c => c.name === 'category');
    return [check('schema', equal(first.columns.slice(0,3),initial.columns) && first.columns.map(c => c.name).join(',') === 'id,text,note,category'
        && categoryColumn?.notnull === 1 && categoryColumn?.type.toUpperCase() === 'TEXT' && defaultValue.category === 'General',
        {expected_original_columns:initial.columns,expected_category_default:'General',observed_columns:first.columns,observed_default:defaultValue}),
      check('preservation',equal(original,seed),{expected:seed,observed:original}),
      check('classification',equal(first.rows,expectedRows),{expected:expectedRows,observed:first.rows}),
      check('idempotence',equal(first,second),{first,second}),
      check('fresh_input',equal(third.rows.slice(0,5),first.rows) && equal(third.rows[5],{id:6,text:'An ERROR and an invoice',note:'fresh',category:'Technical'}) && third.rows.length === 6,
        {expected_existing:first.rows,expected_new:{id:6,text:'An ERROR and an invoice',note:'fresh',category:'Technical'},observed:third.rows})];
  });
}

export async function gradeMission(id, submission, options = {}) {
  try {
    let criteria;
    if (id === 'C01') criteria = gradeFlatten(submission,options);
    else if (id === 'C02') criteria = await (await import('./service.js')).gradeService(submission,options);
    else if (id === 'D01') criteria = gradeReconciliation(submission);
    else if (id === 'D02') criteria = gradeDatabase(submission,options);
    else if (id === 'V01') criteria = gradeVision(submission);
    else if (id === 'B01') criteria = (await import('./ticket_portal.js')).gradeTicketPortal(options.portal, options.browserObservation);
    else throw new Error(`Unknown mission: ${id}`);
    const required = mission(id).task.required_criteria;
    if (!equal(criteria.map(c=>c.id).sort(),[...required].sort())) throw new Error('Grader/contract criterion mismatch');
    return assessment(id, criteria);
  } catch (error) {
    if (error instanceof SubmissionError) return assessment(id,[check('submission_valid',false,error.message)]);
    return assessment(id,[],{name:error.name,message:error.message});
  }
}
