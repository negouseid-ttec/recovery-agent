import fs from 'fs';
import vm from 'vm';
const {normalizeAudit}=require('../demo/web/audit-view');
test('actual dashboard script renders bundled and mixed lifecycle exports',()=>{
 const html=fs.readFileSync('demo/web/dashboard.html','utf8');const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 const nodes:Record<string,any>={};const context:any={console,URLSearchParams,location:{search:''},normalizeAudit,document:{getElementById:(id:string)=>(nodes[id]??={})}};
 vm.createContext(context);for(const source of scripts)vm.runInContext(source,context);
 expect(nodes.tiles.innerHTML).toContain('Illustrative fixtures');
 vm.runInContext(`render([{decisionId:'Q1',correlationId:'Q1',executionState:'queued',evidenceSource:'aws_observed'},{decisionId:'A1',correlationId:'A1',executionState:'provider_accepted',evidenceSource:'aws_observed',providerMessageIds:['P1']},{decisionId:'F1',executionResult:'dispatched',evidenceSource:'illustrative'}],'live','test')`,context);
 expect(nodes.tiles.innerHTML).toContain('Provider accepted');expect(nodes.tiles.innerHTML).toContain('Confirmed delivered');expect(nodes.rows.innerHTML).toContain('provider_accepted');expect(nodes.rows.innerHTML).toContain('ILLUSTRATIVE');
});
test.each(['index.html','architecture.html','dashboard.html'])('static interface %s keeps its inline scripts syntactically valid',name=>{const html=fs.readFileSync('demo/web/'+name,'utf8');for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){if(m[1].trim())expect(()=>new vm.Script(m[1])).not.toThrow();}});
