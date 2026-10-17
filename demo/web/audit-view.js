/* Shared by the static dashboard and offline tests. */
(function(root){
 function normalizeAudit(rows){
  const groups=new Map();
  const parents=rows.filter(r=>!String(r.decisionId).startsWith('SEND-'));
  for(const r of rows){const key=r.sourceDecisionId||(String(r.decisionId).startsWith('SEND-')?parents.find(p=>p.correlationId===r.correlationId)?.decisionId:r.decisionId)||r.decisionId;const group=groups.get(key)||[];group.push(r);groups.set(key,group);}
  return [...groups.values()].map(group=>{
   const base=group.find(r=>!String(r.decisionId).startsWith('SEND-'))||group[0];
   const execution=group.find(r=>String(r.decisionId).startsWith('SEND-'));
   const r={...base,...(execution?{executionState:execution.executionState,providerMessageIds:execution.providerMessageIds,reasonCode:execution.reasonCode,policyDecision:execution.policyDecision||base.policyDecision}:{} )};
   const legacy={dispatched:'queued',blocked:'policy_blocked',error:'failed',skipped:'suppressed'};
   r.executionState=r.executionState||legacy[r.executionResult]||r.executionResult||'recommended';
   r.executionResult=r.executionState;
   r.evidenceSource=r.evidenceSource||(r._src==='ex'?'illustrative':r._src==='live'?'aws_observed':'historical_unverified');
   r.policyDecision=r.policyDecision||{allowed:false,reasonCode:r.reasonCode||'NOT_RECORDED',reason:'No policy decision recorded on this legacy row.'};
   r.executedAction=r.executedAction||'send';return r;
  });
 }
 if(typeof module!=='undefined')module.exports={normalizeAudit};
 else root.normalizeAudit=normalizeAudit;
})(typeof globalThis!=='undefined'?globalThis:this);
