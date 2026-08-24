import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{r as y}from"./index-UiW3gZKV.js";import{r as H}from"./rtl-decorator-oYb0FejH.js";import{B as v}from"./button-CSdgWkZr.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";function m({items:s,onFilesSelected:g,onRemove:o,accept:a,multiple:t=!0,chooseLabel:i,...O}){const x=y.useRef(null),[z,V]=y.useState("");function G(e){if(!e||e.length===0)return;const h=Array.from(e);g(h),V(`${h.length} file${h.length===1?"":"s"} selected`)}return r.jsxs("div",{children:[r.jsx("input",{ref:x,type:"file",className:"sr-only",accept:a,multiple:t,"aria-label":O["aria-label"],onChange:e=>{G(e.target.files),e.target.value=""}}),r.jsx(v,{type:"button",variant:"outline",onClick:()=>{var e;return(e=x.current)==null?void 0:e.click()},children:i??(t?"Choose files":"Choose file")}),r.jsx("div",{"aria-live":"polite",className:"sr-only",children:z}),s.length>0&&r.jsx("ul",{className:"mt-2 space-y-1",children:s.map(e=>r.jsxs("li",{className:"flex items-center gap-2 text-sm",children:[r.jsx("span",{className:"flex-1 truncate",children:e.file.name}),e.error?r.jsx("span",{role:"alert",className:"text-destructive",children:e.error}):e.progress!==void 0&&e.progress<100?r.jsxs("span",{"aria-live":"polite",children:[e.progress,"%"]}):r.jsx("span",{className:"text-muted-foreground",children:"Done"}),o&&r.jsx(v,{type:"button",iconOnly:!0,"aria-label":`Remove ${e.file.name}`,variant:"ghost",size:"icon-sm",onClick:()=>o(e.file),children:r.jsx("span",{"aria-hidden":"true",children:"×"})})]},e.id))})]})}m.__docgenInfo={description:"",methods:[],displayName:"FileUpload",props:{items:{required:!0,tsType:{name:"Array",elements:[{name:"FileUploadItem"}],raw:"FileUploadItem[]"},description:""},onFilesSelected:{required:!0,tsType:{name:"signature",type:"function",raw:"(files: File[]) => void",signature:{arguments:[{type:{name:"Array",elements:[{name:"File"}],raw:"File[]"},name:"files"}],return:{name:"void"}}},description:""},onRemove:{required:!1,tsType:{name:"signature",type:"function",raw:"(file: File) => void",signature:{arguments:[{type:{name:"File"},name:"file"}],return:{name:"void"}}},description:""},accept:{required:!1,tsType:{name:"string"},description:""},multiple:{required:!1,tsType:{name:"boolean"},description:"",defaultValue:{value:"true",computed:!1}},"aria-label":{required:!0,tsType:{name:"string"},description:""},chooseLabel:{required:!1,tsType:{name:"string"},description:""}}};const re={title:"Components/FileUpload",component:m,tags:["autodocs"]};function u(s){return new File(["content"],s,{type:"text/csv"})}function f({initialItems:s=[]}){const[g,o]=y.useState(s);return r.jsx(m,{"aria-label":"Attachments",items:g,onFilesSelected:a=>o(t=>[...t,...a.map(i=>({id:crypto.randomUUID(),file:i,progress:0}))]),onRemove:a=>o(t=>t.filter(i=>i.file!==a))})}const n={render:()=>r.jsx(f,{})},d={render:()=>r.jsx(f,{initialItems:[{id:"roster",file:u("roster.csv"),progress:100}]})},p={name:"Loading (upload in progress)",render:()=>r.jsx(f,{initialItems:[{id:"roster",file:u("roster.csv"),progress:42}]})},l={render:()=>r.jsx(f,{initialItems:[{id:"roster",file:u("roster.csv"),error:"File exceeds the 5 MB limit"}]})},c={render:()=>r.jsx(m,{"aria-label":"সংযুক্তি",chooseLabel:"ফাইল নির্বাচন করুন",items:[{id:"roster",file:u("roster.csv"),progress:100}],onFilesSelected:()=>{}}),decorators:[H]};var F,j,b,S,D;n.parameters={...n.parameters,docs:{...(F=n.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: () => <Demo />
}`,...(b=(j=n.parameters)==null?void 0:j.docs)==null?void 0:b.source},description:{story:"No files selected yet.",...(D=(S=n.parameters)==null?void 0:S.docs)==null?void 0:D.description}}};var I,N,T;d.parameters={...d.parameters,docs:{...(I=d.parameters)==null?void 0:I.docs,source:{originalSource:`{
  render: () => <Demo initialItems={[{
    id: 'roster',
    file: makeFile('roster.csv'),
    progress: 100
  }]} />
}`,...(T=(N=d.parameters)==null?void 0:N.docs)==null?void 0:T.source}}};var k,U,q;p.parameters={...p.parameters,docs:{...(k=p.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: 'Loading (upload in progress)',
  render: () => <Demo initialItems={[{
    id: 'roster',
    file: makeFile('roster.csv'),
    progress: 42
  }]} />
}`,...(q=(U=p.parameters)==null?void 0:U.docs)==null?void 0:q.source}}};var w,E,L,R,C;l.parameters={...l.parameters,docs:{...(w=l.parameters)==null?void 0:w.docs,source:{originalSource:`{
  render: () => <Demo initialItems={[{
    id: 'roster',
    file: makeFile('roster.csv'),
    error: 'File exceeds the 5 MB limit'
  }]} />
}`,...(L=(E=l.parameters)==null?void 0:E.docs)==null?void 0:L.source},description:{story:`Stands in for this issue's "error" state category.`,...(C=(R=l.parameters)==null?void 0:R.docs)==null?void 0:C.description}}};var A,B,_,$,M;c.parameters={...c.parameters,docs:{...(A=c.parameters)==null?void 0:A.docs,source:{originalSource:`{
  render: () => <FileUpload aria-label="সংযুক্তি" chooseLabel="ফাইল নির্বাচন করুন" items={[{
    id: 'roster',
    file: makeFile('roster.csv'),
    progress: 100
  }]} onFilesSelected={() => {}} />,
  decorators: [rtlDecorator]
}`,...(_=(B=c.parameters)==null?void 0:B.docs)==null?void 0:_.source},description:{story:'No dedicated "Disabled" story: the trigger is a `Button`, whose own\n`disabled` state is already covered in `button.stories.tsx`.',...(M=($=c.parameters)==null?void 0:$.docs)==null?void 0:M.description}}};const se=["Empty","Default","Loading","ErrorState","RightToLeft"];export{d as Default,n as Empty,l as ErrorState,p as Loading,c as RightToLeft,se as __namedExportsOrder,re as default};
