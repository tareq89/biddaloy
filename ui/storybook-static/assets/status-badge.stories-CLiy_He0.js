import{j as a}from"./jsx-runtime-D_zvdyIk.js";import{E as d,a as u,C as n,I as c,b as l,F as t}from"./audiences-Bux8_wbq.js";import{r as U}from"./rtl-decorator-oYb0FejH.js";import{c as B}from"./utils-DCADjnpI.js";import{c as m}from"./createLucideIcon-xFpSlqfg.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],L=m("circle-check",M);/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const F=[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]],P=m("circle-dashed",F);/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}]],V=m("circle-minus",Y);/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],z=m("clock",G);/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],q=m("triangle-alert",$),H={success:{fg:"text-status-paid-fg",bg:"bg-status-paid-bg",icon:L},info:{fg:"text-status-partial-fg",bg:"bg-status-partial-bg",icon:P},warning:{fg:"text-status-due-fg",bg:"bg-status-due-bg",icon:z},danger:{fg:"text-status-overdue-fg",bg:"bg-status-overdue-bg",icon:q},neutral:{fg:"text-muted-foreground",bg:"bg-muted",icon:V}};function Q(e){const r=e.toLowerCase().replace(/_/g," ");return r.charAt(0).toUpperCase()+r.slice(1)}const W={[t.PENDING]:"warning",[t.PARTIALLY_PAID]:"info",[t.PAID]:"success",[t.OVERDUE]:"danger",[t.WAIVED]:"neutral",[t.ADVANCE]:"info"},J={[l.SUCCESS]:"success",[l.PENDING]:"warning",[l.FAILED]:"danger",[l.REFUNDED]:"neutral"},K={[c.DRAFT]:"neutral",[c.ISSUED]:"info",[c.PAID]:"success",[c.CANCELLED]:"neutral",[c.OVERDUE]:"danger"},X={[n.QUEUED]:"neutral",[n.SENT]:"info",[n.DELIVERED]:"info",[n.FAILED]:"danger",[n.READ]:"success"},Z={[u.PROCESSING]:"info",[u.COMPLETED]:"success",[u.PARTIALLY_FAILED]:"warning",[u.FAILED]:"danger"},ee={[d.ACTIVE]:"success",[d.INACTIVE]:"neutral",[d.TRANSFERRED]:"info",[d.GRADUATED]:"success"},ae={CURRENT:"success",NOT_CURRENT:"neutral"};function se(e){switch(e.domain){case"fee":return W[e.status];case"payment":return J[e.status];case"invoice":return K[e.status];case"communication":return X[e.status];case"reminderBatch":return Z[e.status];case"enrollment":return ee[e.status];case"academicYear":return ae[e.status]}}function s(e){const r=se(e),{fg:C,bg:I,icon:w}=H[r],k=Q(e.status);return a.jsxs("span",{"data-slot":"status-badge","data-tone":r,className:B("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",C,I),children:[a.jsx(w,{className:"size-3.5"}),k]})}s.__docgenInfo={description:"",methods:[],displayName:"StatusBadge"};const ue={title:"Components/StatusBadge",tags:["autodocs"]},p={render:()=>a.jsx(s,{domain:"fee",status:t.PAID})},o={render:()=>a.jsxs("div",{className:"flex flex-col gap-3",children:[a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(t).map(e=>a.jsx(s,{domain:"fee",status:e},e))}),a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(l).map(e=>a.jsx(s,{domain:"payment",status:e},e))}),a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(c).map(e=>a.jsx(s,{domain:"invoice",status:e},e))}),a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(n).map(e=>a.jsx(s,{domain:"communication",status:e},e))}),a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(u).map(e=>a.jsx(s,{domain:"reminderBatch",status:e},e))}),a.jsx("div",{className:"flex flex-wrap gap-2",children:Object.values(d).map(e=>a.jsx(s,{domain:"enrollment",status:e},e))}),a.jsxs("div",{className:"flex flex-wrap gap-2",children:[a.jsx(s,{domain:"academicYear",status:"CURRENT"}),a.jsx(s,{domain:"academicYear",status:"NOT_CURRENT"})]})]})},i={render:()=>a.jsx("div",{className:"flex flex-wrap gap-2",style:{filter:"grayscale(1)"},children:Object.values(t).map(e=>a.jsx(s,{domain:"fee",status:e},e))})},g={render:()=>a.jsx(s,{domain:"fee",status:t.OVERDUE}),decorators:[U]};var f,x,E;p.parameters={...p.parameters,docs:{...(f=p.parameters)==null?void 0:f.docs,source:{originalSource:`{
  render: () => <StatusBadge domain="fee" status={FeeStatus.PAID} />
}`,...(E=(x=p.parameters)==null?void 0:x.docs)==null?void 0:E.source}}};var N,S,h,v,y;o.parameters={...o.parameters,docs:{...(N=o.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {Object.values(FeeStatus).map(status => <StatusBadge key={status} domain="fee" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(PaymentStatus).map(status => <StatusBadge key={status} domain="payment" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(InvoiceStatus).map(status => <StatusBadge key={status} domain="invoice" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(CommunicationStatus).map(status => <StatusBadge key={status} domain="communication" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(ReminderBatchStatus).map(status => <StatusBadge key={status} domain="reminderBatch" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(EnrollmentStatus).map(status => <StatusBadge key={status} domain="enrollment" status={status} />)}
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge domain="academicYear" status="CURRENT" />
        <StatusBadge domain="academicYear" status="NOT_CURRENT" />
      </div>
    </div>
}`,...(h=(S=o.parameters)==null?void 0:S.docs)==null?void 0:h.source},description:{story:"Every status this component covers, across all `shared/src/enums`\ndomains plus `academicYear` (a plain boolean, not a `shared` enum —\nsee the component's own header comment) — the issue's own acceptance\ncriterion.",...(y=(v=o.parameters)==null?void 0:v.docs)==null?void 0:y.description}}};var T,A,j,D,b;i.parameters={...i.parameters,docs:{...(T=i.parameters)==null?void 0:T.docs,source:{originalSource:`{
  render: () => <div className="flex flex-wrap gap-2" style={{
    filter: 'grayscale(1)'
  }}>
      {Object.values(FeeStatus).map(status => <StatusBadge key={status} domain="fee" status={status} />)}
    </div>
}`,...(j=(A=i.parameters)==null?void 0:A.docs)==null?void 0:j.source},description:{story:"The issue's own acceptance criterion: each status must be\ndistinguishable **without colour** — `grayscale(1)` proves the icon\nshape (not the colour) is what actually carries the meaning.",...(b=(D=i.parameters)==null?void 0:D.docs)==null?void 0:b.description}}};var _,O,R;g.parameters={...g.parameters,docs:{...(_=g.parameters)==null?void 0:_.docs,source:{originalSource:`{
  render: () => <StatusBadge domain="fee" status={FeeStatus.OVERDUE} />,
  decorators: [rtlDecorator]
}`,...(R=(O=g.parameters)==null?void 0:O.docs)==null?void 0:R.source}}};const le=["Default","AllDomains","Greyscale","RightToLeft"];export{o as AllDomains,p as Default,i as Greyscale,g as RightToLeft,le as __namedExportsOrder,ue as default};
