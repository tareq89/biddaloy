import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{within as m,userEvent as b,expect as C}from"./index-DH-M5T-F.js";import{r as R}from"./rtl-decorator-oYb0FejH.js";import{r as S}from"./index-UiW3gZKV.js";import{u as M,S as k}from"./region-config-provider-SX_1hLW0.js";import"./region-config--uWVo8X_.js";import"./audiences-Bux8_wbq.js";import"./client-BiXfQP02.js";import{B}from"./button-CSdgWkZr.js";import{M as D,a as O,b as _,e as T,f as A,g as N}from"./menu-BwKv20x2.js";import{c as P}from"./createLucideIcon-xFpSlqfg.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-C1lOldoC.js";import"./index-DD6Vm61B.js";import"./auth-state-ZwiaXXcL.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./check-B73r9F68.js";import"./index-DpBxWE_S.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./index-BLk8Aw2z.js";import"./index-PfDNeppy.js";import"./index-BYSY9Ylb.js";import"./index-Bl6Aqj_e.js";import"./index-OHns5vBu.js";import"./index-Bhm9YY3U.js";import"./index-DzIv3PRx.js";/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=[["path",{d:"m5 8 6 6",key:"1wu5hv"}],["path",{d:"m4 14 6-6 2-3",key:"1k1g8d"}],["path",{d:"M2 5h12",key:"or177f"}],["path",{d:"M7 2h1",key:"1t2jsx"}],["path",{d:"m22 22-5-10-5 10",key:"don7ne"}],["path",{d:"M14 18h6",key:"1m8k6r"}]],V=P("languages",I),p={bn:"বাংলা",en:"English"};function n({align:o="end"}){const{locale:a,setLocale:c}=M(),[L,j]=S.useState("");function E(t){const l=t;l!==a&&(c(l),j(`Language switched to ${p[l]}`))}return e.jsxs(e.Fragment,{children:[e.jsxs(D,{children:[e.jsx(O,{asChild:!0,children:e.jsx(B,{variant:"ghost",iconOnly:!0,"aria-label":"Change language",children:e.jsx(V,{})})}),e.jsxs(_,{align:o,children:[e.jsx(T,{children:"Language"}),e.jsx(A,{value:a,onValueChange:E,children:k.map(t=>e.jsx(N,{value:t,children:p[t]},t))})]})]}),e.jsx("span",{className:"sr-only","aria-live":"polite",children:L})]})}n.__docgenInfo={description:"",methods:[],displayName:"LocaleSwitcher",props:{align:{required:!1,tsType:{name:"ReactComponentProps['align']",raw:"React.ComponentProps<typeof MenuContent>['align']"},description:"Where the menu opens relative to the trigger — forwarded to\n`MenuContent`'s `align`. Defaults to `'end'`, the natural fit for an\naccount-menu-style trigger sitting at the edge of a header.",defaultValue:{value:"'end'",computed:!1}}}};const fe={title:"Components/LocaleSwitcher",component:n,tags:["autodocs"],parameters:{docs:{description:{component:`No loading/error/disabled state applies here — this isn't a
form control or a data-fetching component, just a trigger over a fixed,
locally-known list of locales. Default (closed) and Open cover the
component's real states; RTL proves the trigger and menu content both
survive a bidi flip (the menu itself renders in a Radix content portal,
outside this story's own \`dir="rtl"\` wrapper — see \`rtl-decorator.tsx\`'s
own comment on why it also sets \`document.documentElement.dir\`).`}}}},r={render:()=>e.jsx(n,{})},s={play:async({canvasElement:o})=>{const a=m(o);await b.click(a.getByRole("button",{name:"Change language"}));const c=m(o.ownerDocument.body);await C(c.findByRole("menuitemradio",{name:"English"})).resolves.toBeTruthy()},render:()=>e.jsx(n,{})},i={decorators:[R],render:()=>e.jsx(n,{align:"start"})};var d,u,h;r.parameters={...r.parameters,docs:{...(d=r.parameters)==null?void 0:d.docs,source:{originalSource:`{
  render: () => <LocaleSwitcher />
}`,...(h=(u=r.parameters)==null?void 0:u.docs)==null?void 0:h.source}}};var g,f,y;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:`{
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Change language'
    }));
    // Menu content portals to document.body, outside canvasElement — same
    // reasoning as dialog.stories.tsx's own play functions.
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole('menuitemradio', {
      name: 'English'
    })).resolves.toBeTruthy();
  },
  render: () => <LocaleSwitcher />
}`,...(y=(f=s.parameters)==null?void 0:f.docs)==null?void 0:y.source}}};var x,w,v;i.parameters={...i.parameters,docs:{...(x=i.parameters)==null?void 0:x.docs,source:{originalSource:`{
  decorators: [rtlDecorator],
  render: () => <LocaleSwitcher align="start" />
}`,...(v=(w=i.parameters)==null?void 0:w.docs)==null?void 0:v.source}}};const ye=["Default","Open","Rtl"];export{r as Default,s as Open,i as Rtl,ye as __namedExportsOrder,fe as default};
