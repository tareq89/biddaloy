import{r as $}from"./rtl-decorator-oYb0FejH.js";import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{B as u}from"./button-CSdgWkZr.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";function z({page:E,pageSize:C,totalCount:a,onPageChange:c,previousLabel:D="Previous",nextLabel:_="Next"}){const p=Math.max(1,C),m=Math.max(1,Math.ceil(a/p)),e=Math.min(Math.max(E,1),m),w=a===0?0:(e-1)*p+1,R=Math.min(e*p,a);return r.jsxs("nav",{"aria-label":"Pagination",className:"flex items-center justify-between text-sm",children:[r.jsx("span",{"aria-live":"polite",className:"text-muted-foreground",children:a===0?"No results":`Showing ${w}–${R} of ${a}`}),r.jsxs("div",{className:"flex gap-1.5",children:[r.jsx(u,{type:"button",variant:"outline",size:"sm",disabled:e<=1,onClick:()=>c(e-1),children:D}),r.jsx(u,{type:"button",variant:"outline",size:"sm",disabled:e>=m,onClick:()=>c(e+1),children:_})]})]})}z.__docgenInfo={description:"",methods:[],displayName:"Pagination",props:{page:{required:!0,tsType:{name:"number"},description:""},pageSize:{required:!0,tsType:{name:"number"},description:""},totalCount:{required:!0,tsType:{name:"number"},description:""},onPageChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(page: number) => void",signature:{arguments:[{type:{name:"number"},name:"page"}],return:{name:"void"}}},description:""},previousLabel:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:"'Previous'",computed:!1}},nextLabel:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:"'Next'",computed:!1}}}};const J={title:"Components/Pagination",component:z,tags:["autodocs"],args:{page:2,pageSize:20,totalCount:145,onPageChange:()=>{}}},s={},o={args:{page:1}},n={args:{page:8}},t={args:{page:1,totalCount:0}},i={args:{previousLabel:"পূর্ববর্তী",nextLabel:"পরবর্তী"},decorators:[$]};var d,g,l;s.parameters={...s.parameters,docs:{...(d=s.parameters)==null?void 0:d.docs,source:{originalSource:"{}",...(l=(g=s.parameters)==null?void 0:g.docs)==null?void 0:l.source}}};var f,x,b;o.parameters={...o.parameters,docs:{...(f=o.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    page: 1
  }
}`,...(b=(x=o.parameters)==null?void 0:x.docs)==null?void 0:b.source}}};var h,y,v;n.parameters={...n.parameters,docs:{...(h=n.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    page: 8
  }
}`,...(v=(y=n.parameters)==null?void 0:y.docs)==null?void 0:v.source}}};var P,L,S,j,N;t.parameters={...t.parameters,docs:{...(P=t.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    page: 1,
    totalCount: 0
  }
}`,...(S=(L=t.parameters)==null?void 0:L.docs)==null?void 0:S.source},description:{story:`No results — stands in for this issue's "empty" state category.`,...(N=(j=t.parameters)==null?void 0:j.docs)==null?void 0:N.description}}};var T,q,M;i.parameters={...i.parameters,docs:{...(T=i.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    previousLabel: 'পূর্ববর্তী',
    nextLabel: 'পরবর্তী'
  },
  decorators: [rtlDecorator]
}`,...(M=(q=i.parameters)==null?void 0:q.docs)==null?void 0:M.source}}};const K=["Default","FirstPage","LastPage","Empty","RightToLeft"];export{s as Default,t as Empty,o as FirstPage,n as LastPage,i as RightToLeft,K as __namedExportsOrder,J as default};
