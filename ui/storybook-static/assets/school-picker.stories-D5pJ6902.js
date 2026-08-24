import{U as a}from"./audiences-Bux8_wbq.js";import{r as b}from"./rtl-decorator-oYb0FejH.js";import{j as o}from"./jsx-runtime-D_zvdyIk.js";import{r as j}from"./index-UiW3gZKV.js";import"./region-config-provider-SX_1hLW0.js";import"./region-config--uWVo8X_.js";import{u as N}from"./client-BiXfQP02.js";import{c as T}from"./utils-DCADjnpI.js";import{B as v}from"./button-CSdgWkZr.js";import{R as k,a as P}from"./radio-DsafL-ua.js";import"./_commonjsHelpers-CqkleIqs.js";import"./iframe-C1lOldoC.js";import"./index-DD6Vm61B.js";import"./auth-state-ZwiaXXcL.js";import"./button-DtSgWxv7.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";import"./index-DpBxWE_S.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./index-DzIv3PRx.js";import"./index-BLk8Aw2z.js";import"./index-BYSY9Ylb.js";import"./index-Bhm9YY3U.js";function s(e){return`${e.tenantId}:${e.role}`}function U({school:e,selected:p}){const{t:n}=N("auth"),t=e.name??n("schoolPicker.unnamedSchool"),l=n(`schoolPicker.roles.${e.role}`),c=`school-picker-option-${s(e)}`;return o.jsxs("label",{htmlFor:c,className:T("flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors",p?"border-primary bg-primary/5":"border-input hover:bg-accent"),children:[o.jsxs("div",{className:"flex flex-col gap-0.5",children:[o.jsx("span",{className:"text-sm font-semibold text-foreground",children:t}),o.jsx("span",{className:"text-sm text-muted-foreground",children:l})]}),o.jsx(P,{id:c,value:s(e),"aria-label":`${t}, ${l}`})]})}function A({schools:e,onSelect:p}){const{t:n}=N("auth"),[t,l]=j.useState(e[0]?s(e[0]):null);function c(){const r=e.find(E=>s(E)===t);r&&p(r.tenantId,r.role)}return o.jsxs("div",{className:"flex flex-col gap-6",children:[o.jsxs("div",{className:"flex flex-col gap-1 text-center",children:[o.jsx("h1",{className:"text-xl font-semibold text-balance",children:n("schoolPicker.heading")}),o.jsx("p",{className:"text-sm text-muted-foreground",children:n("schoolPicker.subtext")})]}),o.jsx(k,{"aria-label":n("schoolPicker.heading"),value:t,onValueChange:l,className:"flex flex-col gap-2",children:e.map(r=>o.jsx(U,{school:r,selected:s(r)===t},s(r)))}),o.jsx(v,{onClick:c,disabled:!t,children:n("schoolPicker.continue")})]})}A.__docgenInfo={description:"",methods:[],displayName:"SchoolPicker",props:{schools:{required:!0,tsType:{name:"Array",elements:[{name:"SchoolPickerOption"}],raw:"SchoolPickerOption[]"},description:""},onSelect:{required:!0,tsType:{name:"signature",type:"function",raw:"(tenantId: string, role: UserRole) => void",signature:{arguments:[{type:{name:"string"},name:"tenantId"},{type:{name:"UserRole"},name:"role"}],return:{name:"void"}}},description:""}}};const te={title:"Components/SchoolPicker",component:A,tags:["autodocs"],args:{onSelect:()=>{}}},i={args:{schools:[{tenantId:"tenant-1",name:"Greenview School",role:a.ADMIN},{tenantId:"tenant-2",name:"Rose Valley School",role:a.TEACHER}]}},m={args:{schools:[{tenantId:"tenant-1",name:"Greenview School",role:a.ADMIN},{tenantId:"tenant-2",name:"Rose Valley School",role:a.TEACHER},{tenantId:"tenant-3",name:"Sunrise Academy",role:a.PARENT}]}},d={args:{schools:[{tenantId:"tenant-1",name:"Greenview School",role:a.ADMIN},{tenantId:"tenant-2",name:"Rose Valley School",role:a.TEACHER}]},decorators:[b]};var u,h,x;i.parameters={...i.parameters,docs:{...(u=i.parameters)==null?void 0:u.docs,source:{originalSource:`{
  args: {
    schools: [{
      tenantId: 'tenant-1',
      name: 'Greenview School',
      role: UserRole.ADMIN
    }, {
      tenantId: 'tenant-2',
      name: 'Rose Valley School',
      role: UserRole.TEACHER
    }]
  }
}`,...(x=(h=i.parameters)==null?void 0:h.docs)==null?void 0:x.source}}};var f,g,R;m.parameters={...m.parameters,docs:{...(f=m.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    schools: [{
      tenantId: 'tenant-1',
      name: 'Greenview School',
      role: UserRole.ADMIN
    }, {
      tenantId: 'tenant-2',
      name: 'Rose Valley School',
      role: UserRole.TEACHER
    }, {
      tenantId: 'tenant-3',
      name: 'Sunrise Academy',
      role: UserRole.PARENT
    }]
  }
}`,...(R=(g=m.parameters)==null?void 0:g.docs)==null?void 0:R.source}}};var S,I,y;d.parameters={...d.parameters,docs:{...(S=d.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    schools: [{
      tenantId: 'tenant-1',
      name: 'Greenview School',
      role: UserRole.ADMIN
    }, {
      tenantId: 'tenant-2',
      name: 'Rose Valley School',
      role: UserRole.TEACHER
    }]
  },
  decorators: [rtlDecorator]
}`,...(y=(I=d.parameters)==null?void 0:I.docs)==null?void 0:y.source}}};const re=["Default","ThreeSchools","RightToLeft"];export{i as Default,d as RightToLeft,m as ThreeSchools,re as __namedExportsOrder,te as default};
