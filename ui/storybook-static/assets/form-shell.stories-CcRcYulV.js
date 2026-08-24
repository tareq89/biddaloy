import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{u as le,a as ce,F as ue,b as j,c as E,d as F,e as N,g as R,o as pe,s as L}from"./form-field-D4d4ym1d.js";import{within as A,userEvent as d,expect as P}from"./index-DH-M5T-F.js";import{r as u}from"./index-UiW3gZKV.js";import{r as ge}from"./rtl-decorator-oYb0FejH.js";import{B as k}from"./button-CSdgWkZr.js";import{I as b}from"./input-MZWbFF1P.js";import"./utils-DCADjnpI.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./index-BA8NevWa.js";import"./index-xLXNAgRb.js";import"./button-DtSgWxv7.js";import"./createLucideIcon-xFpSlqfg.js";function B({title:t,errors:n,submitCount:s,onSubmit:r,children:l}){const i=u.useRef(null),m=u.useRef(s),a=u.useId();return u.useEffect(()=>{var o;s!==m.current&&n.length!==0&&((o=i.current)==null||o.focus(),m.current=s)},[n.length,s]),e.jsxs("form",{onSubmit:r,noValidate:!0,className:"flex max-w-xl flex-col gap-6",children:[t&&e.jsx("h1",{className:"text-lg font-semibold",children:t}),n.length>0&&e.jsxs("div",{ref:i,tabIndex:-1,role:"alert","aria-labelledby":a,className:"rounded-lg border border-destructive/50 bg-destructive/5 p-4 focus:outline-none",children:[e.jsxs("p",{id:a,className:"font-medium text-destructive",children:[n.length===1?"There is 1 problem":`There are ${n.length} problems`," ","with your submission"]}),e.jsx("ul",{className:"mt-2 list-disc ps-5",children:n.map(o=>e.jsx("li",{children:e.jsx("a",{href:`#${o.field}`,className:"text-destructive underline underline-offset-2",onClick:T=>{T.preventDefault();const c=document.getElementById(o.field);c==null||c.focus(),c==null||c.scrollIntoView({block:"center"})},children:o.message})},o.field))})]}),l]})}function f({legend:t,children:n}){return e.jsxs("fieldset",{className:"flex flex-col gap-4 rounded-lg border border-border p-4",children:[e.jsx("legend",{className:"px-1 text-sm font-medium",children:t}),n]})}B.__docgenInfo={description:"",methods:[],displayName:"FormShell",props:{title:{required:!1,tsType:{name:"string"},description:""},errors:{required:!0,tsType:{name:"Array",elements:[{name:"FormShellError"}],raw:"FormShellError[]"},description:""},submitCount:{required:!0,tsType:{name:"number"},description:'`form.formState.submitCount` from react-hook-form — the trigger for\n"focus moves to the summary on submit failure", distinct from the\nerror list itself changing.'},onSubmit:{required:!0,tsType:{name:"signature",type:"function",raw:"(event: React.FormEvent<HTMLFormElement>) => void",signature:{arguments:[{type:{name:"ReactFormEvent",raw:"React.FormEvent<HTMLFormElement>",elements:[{name:"HTMLFormElement"}]},name:"event"}],return:{name:"void"}}},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};f.__docgenInfo={description:"`<fieldset>`/`<legend>` grouping — the issue's own layout requirement.\nA native `<fieldset>` gives every contained control's accessible name a\n\"within {legend}\" context for free, no `aria-*` wiring needed.",methods:[],displayName:"FormSection",props:{legend:{required:!0,tsType:{name:"string"},description:""},children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};function me(){return{mode:"onBlur",reValidateMode:"onBlur"}}function ye(t,n){for(const[s,r]of Object.entries(n))typeof r=="string"&&t(s,{type:"server",message:r})}function Se(t){u.useEffect(()=>{function n(s){t&&(s.preventDefault(),s.returnValue="")}return window.addEventListener("beforeunload",n),()=>window.removeEventListener("beforeunload",n)},[t])}function be(t,n,s={}){const{enabled:r=!0,debounceMs:l=500}=s,i=`form-shell-draft:${t}`,[m,a]=u.useState(()=>{if(typeof window>"u")return!1;try{return window.localStorage.getItem(i)!==null}catch{return!1}}),o=u.useRef(null);u.useEffect(()=>{if(!r)return;const v=setTimeout(()=>{var q;const D=JSON.stringify(n);if(!(((q=o.current)==null?void 0:q.storageKey)===i&&o.current.serialized===D))try{window.localStorage.setItem(i,D),o.current={storageKey:i,serialized:D},a(!0)}catch{}},l);return()=>clearTimeout(v)},[r,i,n,l]);function T(){try{const v=window.localStorage.getItem(i);return v?JSON.parse(v):void 0}catch{return}}function c(){try{window.localStorage.removeItem(i)}catch{}o.current=null,a(!1)}return{draftAvailable:m,restoreDraft:T,discardDraft:c,clearDraft:c}}const Pe={title:"Shells/FormShell",tags:["autodocs"]},he=pe({studentName:L().min(1,"Student name is required"),guardianPhone:L().min(1,"Guardian's phone number is required")});function I(){const t=le({resolver:ce(he),defaultValues:{studentName:"",guardianPhone:""},...me()});Se(t.formState.isDirty&&!t.formState.isSubmitSuccessful);const n=Object.entries(t.formState.errors).map(([r,l])=>({field:r,message:String((l==null?void 0:l.message)??"")}));function s(r){if(r.studentName==="Rahim Uddin"){ye(t.setError,{studentName:"A student with this name is already enrolled"});return}t.reset(r,{keepIsSubmitSuccessful:!0})}return e.jsx(ue,{...t,children:e.jsxs(B,{title:"Admit a student",errors:n,submitCount:t.formState.submitCount,onSubmit:r=>void t.handleSubmit(s)(r),children:[t.formState.isSubmitSuccessful&&e.jsxs("p",{role:"status",children:[t.getValues("studentName")," has been admitted."]}),e.jsx(f,{legend:"Student details",children:e.jsx(j,{control:t.control,name:"studentName",render:({field:r})=>e.jsxs(E,{children:[e.jsx(F,{htmlFor:"studentName",children:"Student name"}),e.jsx(N,{children:e.jsx(b,{id:"studentName",...r})}),e.jsx(R,{})]})})}),e.jsx(f,{legend:"Guardian details",children:e.jsx(j,{control:t.control,name:"guardianPhone",render:({field:r})=>e.jsxs(E,{children:[e.jsx(F,{htmlFor:"guardianPhone",children:"Guardian’s phone"}),e.jsx(N,{children:e.jsx(b,{id:"guardianPhone",...r})}),e.jsx(R,{})]})})}),e.jsx(k,{type:"submit",children:"Admit student"})]})})}const x={render:()=>e.jsx(I,{})},p={render:()=>e.jsx(I,{}),play:async({canvasElement:t})=>{const n=A(t);await d.click(n.getByRole("button",{name:"Admit student"}))}},g={render:()=>e.jsx(I,{}),play:async({canvasElement:t})=>{const n=A(t);await d.type(n.getByLabelText("Student name"),"Rahim Uddin"),await d.type(n.getByLabelText("Guardian’s phone"),"01712345678"),await d.click(n.getByRole("button",{name:"Admit student"}))}},y={render:()=>e.jsx(I,{}),play:async({canvasElement:t})=>{const n=A(t);await d.type(t.querySelector("#studentName"),"Karim Ahmed"),await d.type(t.querySelector("#guardianPhone"),"01812345678"),await d.click(n.getByRole("button",{name:"Admit student"}))}},fe="form-shell-storybook-demo",h="autosave-";function ve(){const t=le({resolver:ce(he),defaultValues:{studentName:"",guardianPhone:""},...me()}),{draftAvailable:n,restoreDraft:s,clearDraft:r}=be(fe,t.watch(),{debounceMs:300}),[l]=u.useState(n),i=Object.entries(t.formState.errors).map(([a,o])=>({field:`${h}${a}`,message:String((o==null?void 0:o.message)??"")}));function m(a){r(),t.reset(a,{keepIsSubmitSuccessful:!0})}return e.jsx(ue,{...t,children:e.jsxs(B,{title:"Admit a student",errors:i,submitCount:t.formState.submitCount,onSubmit:a=>void t.handleSubmit(m)(a),children:[l&&!t.formState.isSubmitSuccessful&&e.jsxs("div",{role:"status",className:"rounded-lg border border-border p-3 text-sm",children:["A previous draft was found."," ",e.jsx("button",{type:"button",className:"text-primary underline underline-offset-2",onClick:()=>{const a=s();a&&t.reset(a)},children:"Restore it"})]}),t.formState.isSubmitSuccessful&&e.jsxs("p",{role:"status",children:[t.getValues("studentName")," has been admitted."]}),e.jsx(f,{legend:"Student details",children:e.jsx(j,{control:t.control,name:"studentName",render:({field:a})=>e.jsxs(E,{children:[e.jsx(F,{htmlFor:`${h}studentName`,children:"Student name"}),e.jsx(N,{children:e.jsx(b,{id:`${h}studentName`,...a})}),e.jsx(R,{})]})})}),e.jsx(f,{legend:"Guardian details",children:e.jsx(j,{control:t.control,name:"guardianPhone",render:({field:a})=>e.jsxs(E,{children:[e.jsx(F,{htmlFor:`${h}guardianPhone`,children:"Guardian’s phone"}),e.jsx(N,{children:e.jsx(b,{id:`${h}guardianPhone`,...a})}),e.jsx(R,{})]})})}),e.jsx(k,{type:"submit",children:"Admit student"})]})})}const S={loaders:[()=>(window.localStorage.setItem(`form-shell-draft:${fe}`,JSON.stringify({studentName:"Nusrat Jahan",guardianPhone:"01912345678"})),{})],render:()=>e.jsx(ve,{}),play:async({canvasElement:t})=>{const n=A(t);await d.click(n.getByRole("button",{name:"Restore it"}));const s=t.querySelector(`#${h}studentName`);await P(s).toHaveValue("Nusrat Jahan"),await d.clear(s),await d.click(n.getByRole("button",{name:"Admit student"})),await d.click(n.getByRole("link",{name:"Student name is required"})),await P(document.activeElement).toBe(s)}},w={render:()=>e.jsxs(B,{title:"একজন শিক্ষার্থী ভর্তি করুন",errors:[],submitCount:0,onSubmit:t=>t.preventDefault(),children:[e.jsxs(f,{legend:"শিক্ষার্থীর বিবরণ",children:[e.jsx("label",{htmlFor:"rtl-student-name",children:"শিক্ষার্থীর নাম"}),e.jsx(b,{id:"rtl-student-name"})]}),e.jsx(k,{type:"submit",children:"ভর্তি করুন"})]}),decorators:[ge]};var V,_,O;x.parameters={...x.parameters,docs:{...(V=x.parameters)==null?void 0:V.docs,source:{originalSource:`{
  render: () => <AdmissionForm />
}`,...(O=(_=x.parameters)==null?void 0:_.docs)==null?void 0:O.source}}};var $,M,U,C,J;p.parameters={...p.parameters,docs:{...($=p.parameters)==null?void 0:$.docs,source:{originalSource:`{
  render: () => <AdmissionForm />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Admit student'
    }));
  }
}`,...(U=(M=p.parameters)==null?void 0:M.docs)==null?void 0:U.source},description:{story:`Stands in for this issue's "error" state category — submitting empty
triggers the error summary at the top, focus moved to it.`,...(J=(C=p.parameters)==null?void 0:C.docs)==null?void 0:J.description}}};var G,H,K,W,z;g.parameters={...g.parameters,docs:{...(G=g.parameters)==null?void 0:G.docs,source:{originalSource:`{
  render: () => <AdmissionForm />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Student name'), 'Rahim Uddin');
    await userEvent.type(canvas.getByLabelText('Guardian’s phone'), '01712345678');
    await userEvent.click(canvas.getByRole('button', {
      name: 'Admit student'
    }));
  }
}`,...(K=(H=g.parameters)==null?void 0:H.docs)==null?void 0:K.source},description:{story:'Submitting "Rahim Uddin" simulates a server rejecting the field —\n`applyServerFieldErrors` maps it onto the same input a client-side\nvalidation error would.',...(z=(W=g.parameters)==null?void 0:W.docs)==null?void 0:z.description}}};var Q,X,Y,Z,ee;y.parameters={...y.parameters,docs:{...(Q=y.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  render: () => <AdmissionForm />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    // Queried by id, matching this file's other stories — \`FormLabel\`'s
    // \`htmlFor\` now follows a caller-supplied value (#8.7.13 fixed the
    // gap DraftRestore's own comment used to describe here), so
    // \`getByLabelText\` would resolve these too; left as \`querySelector\`
    // for consistency with the rest of this file rather than mixing
    // query styles across stories that exercise the same fields.
    await userEvent.type(canvasElement.querySelector('#studentName')!, 'Karim Ahmed');
    await userEvent.type(canvasElement.querySelector('#guardianPhone')!, '01812345678');
    await userEvent.click(canvas.getByRole('button', {
      name: 'Admit student'
    }));
  }
}`,...(Y=(X=y.parameters)==null?void 0:X.docs)==null?void 0:Y.source},description:{story:`A name other than "Rahim Uddin" (which the demo's own \`handleSubmit\`
treats as a server rejection) succeeds — the success message replaces
nothing, it's additive content inside the same \`FormShell\`, since a
real page usually redirects or shows a toast rather than restyling
the form itself.`,...(ee=(Z=y.parameters)==null?void 0:Z.docs)==null?void 0:ee.description}}};var te,ne,re,se,ae;S.parameters={...S.parameters,docs:{...(te=S.parameters)==null?void 0:te.docs,source:{originalSource:`{
  loaders: [() => {
    window.localStorage.setItem(\`form-shell-draft:\${AUTOSAVE_KEY}\`, JSON.stringify({
      studentName: 'Nusrat Jahan',
      guardianPhone: '01912345678'
    }));
    return {};
  }],
  render: () => <AdmissionFormWithAutosave />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Restore it'
    }));

    // Queried by id, the same way \`FormShell\`'s own error-summary links
    // locate a field (\`document.getElementById\`) — consistent with this
    // file's other stories rather than mixing query styles. \`FormLabel\`'s
    // \`htmlFor\` follows a caller-supplied value now (#8.7.13), so this
    // field's label *is* correctly associated with it — \`getByLabelText\`
    // would resolve it too, this just isn't the story exercising that.
    const studentNameField = canvasElement.querySelector<HTMLInputElement>(\`#\${AUTOSAVE_FIELD_ID_PREFIX}studentName\`);
    await expect(studentNameField).toHaveValue('Nusrat Jahan');
    await userEvent.clear(studentNameField!);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Admit student'
    }));
    await userEvent.click(canvas.getByRole('link', {
      name: 'Student name is required'
    }));
    await expect(document.activeElement).toBe(studentNameField);
  }
}`,...(re=(ne=S.parameters)==null?void 0:ne.docs)==null?void 0:re.source},description:{story:'Seeds a draft into `localStorage` before the story mounts, so\n`AdmissionFormWithAutosave` renders straight into the "draft found"\nbanner rather than needing a play function to type first.',...(ae=(se=S.parameters)==null?void 0:se.docs)==null?void 0:ae.description}}};var oe,ie,de;w.parameters={...w.parameters,docs:{...(oe=w.parameters)==null?void 0:oe.docs,source:{originalSource:`{
  render: () => <FormShell title="একজন শিক্ষার্থী ভর্তি করুন" errors={[]} submitCount={0} onSubmit={event => event.preventDefault()}>
      <FormSection legend="শিক্ষার্থীর বিবরণ">
        <label htmlFor="rtl-student-name">শিক্ষার্থীর নাম</label>
        <Input id="rtl-student-name" />
      </FormSection>
      <Button type="submit">ভর্তি করুন</Button>
    </FormShell>,
  decorators: [rtlDecorator]
}`,...(de=(ie=w.parameters)==null?void 0:ie.docs)==null?void 0:de.source}}};const Ve=["Default","ErrorSummary","ServerFieldError","SuccessfulSubmit","DraftRestore","RightToLeft"];export{x as Default,S as DraftRestore,p as ErrorSummary,w as RightToLeft,g as ServerFieldError,y as SuccessfulSubmit,Ve as __namedExportsOrder,Pe as default};
