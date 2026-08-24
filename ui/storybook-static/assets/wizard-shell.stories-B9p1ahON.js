import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as j}from"./index-UiW3gZKV.js";import{a as Z,w as H}from"./router-decorator-BUaLSQct.js";import{r as $}from"./rtl-decorator-oYb0FejH.js";import{I as ee}from"./input-MZWbFF1P.js";import{u as te}from"./navigate-search-CqG7F63U.js";import{B as w}from"./button-CSdgWkZr.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-DD6Vm61B.js";import"./utils-DCADjnpI.js";import"./button-DtSgWxv7.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";function se(n){const c=Z({strict:!1}),s=te(),a=n[0]??"",o=c.step,u=typeof o=="string"&&n.includes(o)?o:a;function m(i){n.includes(i)&&s(x=>({...x,step:i}))}return[u,m]}function f({title:n,steps:c,currentStepId:s,onStepChange:a,onSubmit:o,submitLabel:u="Submit",submitting:m=!1,result:i,reviewStep:x}){const r=x?[...c,x]:c,l=Math.max(0,r.findIndex(t=>t.id===s)),d=r[l],C=l===r.length-1,v=d!=null&&d.isValid?d.isValid():!0,[K,Q]=j.useState(()=>new Set([s]));j.useEffect(()=>{Q(t=>t.has(s)?t:new Set(t).add(s))},[s]);function U(){if(!v||C)return;const t=r[l+1];t&&a(t.id)}function X(){const t=r[l-1];t&&a(t.id)}return i?e.jsxs("div",{className:"flex flex-col gap-4",children:[e.jsx("h1",{className:"text-lg font-semibold",children:n}),i]}):e.jsxs("div",{className:"flex flex-col gap-4",children:[e.jsx("h1",{className:"text-lg font-semibold",children:n}),e.jsx("ol",{className:"flex flex-wrap items-center gap-2 text-sm",children:r.map((t,S)=>{const R=t.id===s,Y=S<l;return e.jsxs("li",{"aria-current":R?"step":void 0,children:[Y?e.jsx("button",{type:"button",className:"text-primary underline-offset-2 hover:underline",onClick:()=>a(t.id),children:t.label}):e.jsx("span",{className:R?"font-medium text-foreground":"text-muted-foreground",children:t.label}),S<r.length-1&&e.jsx("span",{"aria-hidden":"true",className:"ms-2 text-muted-foreground",children:"›"})]},t.id)})}),e.jsxs("div",{"aria-live":"polite",className:"sr-only",children:["Step ",l+1," of ",r.length,": ",d==null?void 0:d.label]}),r.map(t=>{const S=K.has(t.id);return e.jsx("div",{hidden:t.id!==s,children:S?t.content:null},t.id)}),e.jsxs("div",{className:"flex justify-between gap-2",children:[e.jsx(w,{type:"button",variant:"outline",onClick:X,disabled:l===0,children:"Back"}),C?e.jsx(w,{type:"button",loading:m,onClick:o,disabled:!v,children:u}):e.jsx(w,{type:"button",onClick:U,disabled:!v,children:"Next"})]})]})}f.__docgenInfo={description:"",methods:[],displayName:"WizardShell",props:{submitLabel:{defaultValue:{value:"'Submit'",computed:!1},required:!1},submitting:{defaultValue:{value:"false",computed:!1},required:!1}}};const Se={title:"Shells/WizardShell",tags:["autodocs"]},re=["amount","method","review"];function J(){const[n,c]=se(re),[s,a]=j.useState(""),[o,u]=j.useState(!1),m=[{id:"amount",label:"Amount",content:e.jsx(ee,{"aria-label":"Amount",placeholder:"0.00",value:s,onChange:i=>a(i.target.value)}),isValid:()=>s.trim()!==""},{id:"method",label:"Method",content:e.jsx("p",{children:"Choose cash, cheque, or bank transfer."})}];return e.jsx(f,{title:"Record payment",steps:m,currentStepId:n,onStepChange:c,irreversible:!0,reviewStep:{id:"review",label:"Review",content:e.jsxs("p",{children:["Recording a payment of ৳",s||"0.00","."]})},onSubmit:()=>u(!0),result:o?e.jsxs("p",{role:"status",children:["Payment of ৳",s," recorded successfully. A receipt has been sent to the guardian’s registered phone number."]}):void 0})}const b={decorators:[H(["/payments/new"])],render:()=>e.jsx(J,{})},g={decorators:[H(["/payments/new?step=method"])],render:()=>e.jsx(J,{})},p={render:()=>e.jsx(f,{title:"Record payment",steps:[{id:"amount",label:"Amount",content:e.jsx("p",{children:"Enter an amount to continue."}),isValid:()=>!1},{id:"method",label:"Method",content:e.jsx("p",{children:"Choose cash, cheque, or bank transfer."})}],currentStepId:"amount",onStepChange:()=>{},onSubmit:()=>{}})},h={render:()=>e.jsx(f,{title:"Bulk reminders",steps:[{id:"confirm",label:"Confirm",content:e.jsx("p",{children:"Send reminders to 145 guardians?"})}],currentStepId:"confirm",onStepChange:()=>{},onSubmit:()=>{},result:e.jsx("p",{role:"status",children:"142 reminders sent successfully. 3 failed because the guardian has no phone number on file."})})},y={render:()=>e.jsx(f,{title:"পেমেন্ট রেকর্ড করুন",steps:[{id:"amount",label:"পরিমাণ",content:e.jsx("p",{children:"পরিমাণ লিখুন।"})}],currentStepId:"amount",onStepChange:()=>{},onSubmit:()=>{}}),decorators:[$]};var N,k,z;b.parameters={...b.parameters,docs:{...(N=b.parameters)==null?void 0:N.docs,source:{originalSource:`{
  decorators: [withMemoryRouter(['/payments/new'])],
  render: () => <RecordPaymentWizard />
}`,...(z=(k=b.parameters)==null?void 0:k.docs)==null?void 0:z.source}}};var V,W,I;g.parameters={...g.parameters,docs:{...(V=g.parameters)==null?void 0:V.docs,source:{originalSource:`{
  decorators: [withMemoryRouter(['/payments/new?step=method'])],
  render: () => <RecordPaymentWizard />
}`,...(I=(W=g.parameters)==null?void 0:W.docs)==null?void 0:I.source}}};var D,E,M,A,B;p.parameters={...p.parameters,docs:{...(D=p.parameters)==null?void 0:D.docs,source:{originalSource:`{
  render: () => <WizardShell title="Record payment" steps={[{
    id: 'amount',
    label: 'Amount',
    content: <p>Enter an amount to continue.</p>,
    isValid: () => false
  }, {
    id: 'method',
    label: 'Method',
    content: <p>Choose cash, cheque, or bank transfer.</p>
  }]} currentStepId="amount" onStepChange={() => {}} onSubmit={() => {}} />
}`,...(M=(E=p.parameters)==null?void 0:E.docs)==null?void 0:M.source},description:{story:`The first step's \`isValid\` returns \`false\` — "Next" stays disabled
until the caller's own validation says otherwise, one of this shell's
primary behaviors and otherwise only exercised indirectly (by typing a
value) in the other stories.`,...(B=(A=p.parameters)==null?void 0:A.docs)==null?void 0:B.description}}};var L,q,P,_,T;h.parameters={...h.parameters,docs:{...(L=h.parameters)==null?void 0:L.docs,source:{originalSource:`{
  render: () => <WizardShell title="Bulk reminders" steps={[{
    id: 'confirm',
    label: 'Confirm',
    content: <p>Send reminders to 145 guardians?</p>
  }]} currentStepId="confirm" onStepChange={() => {}} onSubmit={() => {}} result={<p role="status">
          142 reminders sent successfully. 3 failed because the guardian has no phone number on
          file.
        </p>} />
}`,...(P=(q=h.parameters)==null?void 0:q.docs)==null?void 0:P.source},description:{story:`Stands in for this issue's "result screen with counts and
plain-language explanations" acceptance criterion.`,...(T=(_=h.parameters)==null?void 0:_.docs)==null?void 0:T.description}}};var F,O,G;y.parameters={...y.parameters,docs:{...(F=y.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: () => <WizardShell title="পেমেন্ট রেকর্ড করুন" steps={[{
    id: 'amount',
    label: 'পরিমাণ',
    content: <p>পরিমাণ লিখুন।</p>
  }]} currentStepId="amount" onStepChange={() => {}} onSubmit={() => {}} />,
  decorators: [rtlDecorator]
}`,...(G=(O=y.parameters)==null?void 0:O.docs)==null?void 0:G.source}}};const be=["Default","DeepLinkedStep","InvalidFirstStep","ResultScreen","RightToLeft"];export{g as DeepLinkedStep,b as Default,p as InvalidFirstStep,h as ResultScreen,y as RightToLeft,be as __namedExportsOrder,Se as default};
