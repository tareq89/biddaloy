import{r as F}from"./rtl-decorator-oYb0FejH.js";import{j as w}from"./jsx-runtime-D_zvdyIk.js";import{c as q}from"./utils-DCADjnpI.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";function E({className:o,...O}){return w.jsx("textarea",{"data-slot":"textarea",className:q("flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",o),...O})}E.__docgenInfo={description:"",methods:[],displayName:"Textarea"};function N(o){return w.jsx(E,{...o})}N.__docgenInfo={description:"",methods:[],displayName:"Textarea"};const G={title:"Components/Textarea",component:N,tags:["autodocs"],args:{"aria-label":"Reminder message",placeholder:"Type a message…"}},t={args:{defaultValue:"Dear {{guardian_name}}, {{student_name}} has an outstanding due."}},e={},s={args:{disabled:!0,defaultValue:"Dear {{guardian_name}}…"}},a={args:{"aria-invalid":!0,defaultValue:""}},r={args:{readOnly:!0,placeholder:"Loading…",defaultValue:""}},n={args:{"aria-label":"রিমাইন্ডার বার্তা",placeholder:"একটি বার্তা লিখুন…",defaultValue:"প্রিয় {{guardian_name}}, {{student_name}}-এর বকেয়া রয়েছে।"},decorators:[F]};var i,d,l;t.parameters={...t.parameters,docs:{...(i=t.parameters)==null?void 0:i.docs,source:{originalSource:`{
  args: {
    defaultValue: 'Dear {{guardian_name}}, {{student_name}} has an outstanding due.'
  }
}`,...(l=(d=t.parameters)==null?void 0:d.docs)==null?void 0:l.source}}};var c,u,m,p,g;e.parameters={...e.parameters,docs:{...(c=e.parameters)==null?void 0:c.docs,source:{originalSource:"{}",...(m=(u=e.parameters)==null?void 0:u.docs)==null?void 0:m.source},description:{story:"No value entered yet — the state a required field starts in.",...(g=(p=e.parameters)==null?void 0:p.docs)==null?void 0:g.description}}};var f,b,h;s.parameters={...s.parameters,docs:{...(f=s.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    disabled: true,
    defaultValue: 'Dear {{guardian_name}}…'
  }
}`,...(h=(b=s.parameters)==null?void 0:b.docs)==null?void 0:h.source}}};var x,v,y,_,V;a.parameters={...a.parameters,docs:{...(x=a.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    'aria-invalid': true,
    defaultValue: ''
  }
}`,...(y=(v=a.parameters)==null?void 0:v.docs)==null?void 0:y.source},description:{story:'Stands in for this issue\'s "error" state category. Real error text and\n`aria-describedby` linkage belong to `FormField` ([8.6.3]), which\ncomposes this — a bare `Textarea` only carries the visual/`aria-invalid`\nhalf of that contract.',...(V=(_=a.parameters)==null?void 0:_.docs)==null?void 0:V.description}}};var D,T,L,S,k;r.parameters={...r.parameters,docs:{...(D=r.parameters)==null?void 0:D.docs,source:{originalSource:`{
  args: {
    readOnly: true,
    placeholder: 'Loading…',
    defaultValue: ''
  }
}`,...(L=(T=r.parameters)==null?void 0:T.docs)==null?void 0:L.source},description:{story:'`Textarea` has no loading state of its own — see `Input`\'s story for\nthe same reasoning. `readOnly` + a "Loading…" placeholder is the\nclosest single-component analog.',...(k=(S=r.parameters)==null?void 0:S.docs)==null?void 0:k.description}}};var I,R,j;n.parameters={...n.parameters,docs:{...(I=n.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    'aria-label': 'রিমাইন্ডার বার্তা',
    placeholder: 'একটি বার্তা লিখুন…',
    defaultValue: 'প্রিয় {{guardian_name}}, {{student_name}}-এর বকেয়া রয়েছে।'
  },
  decorators: [rtlDecorator]
}`,...(j=(R=n.parameters)==null?void 0:R.docs)==null?void 0:j.source}}};const H=["Default","Empty","Disabled","InvalidValue","Loading","RightToLeft"];export{t as Default,s as Disabled,e as Empty,a as InvalidValue,r as Loading,n as RightToLeft,H as __namedExportsOrder,G as default};
