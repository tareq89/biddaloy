import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as d}from"./index-UiW3gZKV.js";import{r as de}from"./rtl-decorator-oYb0FejH.js";import{B as le}from"./button-CSdgWkZr.js";import{D as J}from"./data-table-BAh8cV6L.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";import"./checkbox-Ul0x0zrJ.js";import"./check-B73r9F68.js";import"./index-DpBxWE_S.js";import"./index-Bhm9YY3U.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./menu-BwKv20x2.js";import"./index-BLk8Aw2z.js";import"./index-PfDNeppy.js";import"./index-BYSY9Ylb.js";import"./index-Bl6Aqj_e.js";import"./index-OHns5vBu.js";import"./index-DzIv3PRx.js";import"./chevron-down-BYjJGfBe.js";import"./chevron-right-DyYLX4lm.js";const Ue={title:"Components/DataTable",tags:["autodocs"]},g=[{id:"1",name:"Rahim Uddin",className:"Six",status:"Active"},{id:"2",name:"Karim Ahmed",className:"Seven",status:"Active"},{id:"3",name:"Fatema Begum",className:"Six",status:"Inactive"}],Q=[{id:"name",header:"Name",accessorFn:t=>t.name,sortable:!0},{id:"className",header:"Class",accessorFn:t=>t.className,sortable:!0},{id:"status",header:"Status",accessorFn:t=>t.status}];function s(t){const{data:b=g,totalCount:S=g.length,loading:h=!1,error:l,selectable:a=!1,tableId:V="students-demo",caption:X="Students",columns:Y=Q,columnsMenu:Z=!1}=t,[ee,te]=d.useState(null),[ae,se]=d.useState(1),[re,oe]=d.useState(new Set);return e.jsx(J,{tableId:V,caption:X,columns:Y,data:b,getRowId:ne=>ne.id,sorting:ee,onSortingChange:te,page:ae,pageSize:20,totalCount:S,onPageChange:se,loading:h,columnsMenu:Z,...l!==void 0?{error:l}:{},...a?{selectedIds:re,onSelectedIdsChange:oe,bulkActions:e.jsx(le,{type:"button",size:"sm",variant:"destructive",children:"Delete selected"})}:{}})}const c={render:()=>e.jsx(s,{tableId:"students-default"})},i={render:()=>e.jsx(s,{tableId:"students-loading",loading:!0})},m={render:()=>e.jsx(s,{tableId:"students-empty",data:[],totalCount:0})},r={render:()=>e.jsx(s,{tableId:"students-error",data:[],error:"Failed to load students"})},u={render:()=>e.jsx(s,{tableId:"students-selectable",selectable:!0})},o={render:()=>e.jsx(s,{tableId:"students-columns-menu",columnsMenu:!0})},n={render:()=>{function t(){const[b,S]=d.useState(null),[h,l]=d.useState(1);return e.jsx(J,{tableId:"students-expandable",caption:"Students",columns:Q,data:g,getRowId:a=>a.id,sorting:b,onSortingChange:S,page:h,pageSize:20,totalCount:g.length,onPageChange:l,expandRowLabel:a=>`Details for ${a.name}`,renderExpandedRow:a=>e.jsxs("div",{className:"p-4",children:[e.jsxs("p",{className:"text-sm font-medium",children:["Details for ",a.name]}),e.jsxs("p",{className:"text-sm text-muted-foreground",children:["Class: ",a.className," · Status: ",a.status]})]})})}return e.jsx(t,{})}},p={render:()=>e.jsx(s,{tableId:"students-rtl",caption:"শিক্ষার্থীগণ",columns:[{id:"name",header:"নাম",accessorFn:t=>t.name,sortable:!0},{id:"className",header:"শ্রেণি",accessorFn:t=>t.className}]}),decorators:[de]};var x,f,D;c.parameters={...c.parameters,docs:{...(x=c.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-default" />
}`,...(D=(f=c.parameters)==null?void 0:f.docs)==null?void 0:D.source}}};var w,I,N;i.parameters={...i.parameters,docs:{...(w=i.parameters)==null?void 0:w.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-loading" loading />
}`,...(N=(I=i.parameters)==null?void 0:I.docs)==null?void 0:N.source}}};var C,E,j;m.parameters={...m.parameters,docs:{...(C=m.parameters)==null?void 0:C.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-empty" data={[]} totalCount={0} />
}`,...(j=(E=m.parameters)==null?void 0:E.docs)==null?void 0:j.source}}};var v,y,R,T,F;r.parameters={...r.parameters,docs:{...(v=r.parameters)==null?void 0:v.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-error" data={[]} error="Failed to load students" />
}`,...(R=(y=r.parameters)==null?void 0:y.docs)==null?void 0:R.source},description:{story:`Stands in for this issue's "error" state category.`,...(F=(T=r.parameters)==null?void 0:T.docs)==null?void 0:F.description}}};var L,M,P;u.parameters={...u.parameters,docs:{...(L=u.parameters)==null?void 0:L.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-selectable" selectable />
}`,...(P=(M=u.parameters)==null?void 0:M.docs)==null?void 0:P.source}}};var U,z,A,B,O;o.parameters={...o.parameters,docs:{...(U=o.parameters)==null?void 0:U.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-columns-menu" columnsMenu />
}`,...(A=(z=o.parameters)==null?void 0:z.docs)==null?void 0:A.source},description:{story:`The opt-in "Columns" toggle — [8.10.1]'s "default columns visible, the
rest behind a Columns menu" requirement. Off by default (see \`Default\`
above, which renders no trigger at all); a caller with more columns
than belong in the default view turns this on.`,...(O=(B=o.parameters)==null?void 0:B.docs)==null?void 0:O.description}}};var k,W,_,$,q;n.parameters={...n.parameters,docs:{...(k=n.parameters)==null?void 0:k.docs,source:{originalSource:`{
  render: () => {
    function ExpandableDemo() {
      const [sorting, setSorting] = useState<DataTableSort | null>(null);
      const [page, setPage] = useState(1);
      return <DataTable tableId="students-expandable" caption="Students" columns={COLUMNS} data={STUDENTS} getRowId={row => row.id} sorting={sorting} onSortingChange={setSorting} page={page} pageSize={20} totalCount={STUDENTS.length} onPageChange={setPage} expandRowLabel={row => \`Details for \${row.name}\`} renderExpandedRow={row => <div className="p-4">
              <p className="text-sm font-medium">Details for {row.name}</p>
              <p className="text-sm text-muted-foreground">
                Class: {row.className} · Status: {row.status}
              </p>
            </div>} />;
    }
    return <ExpandableDemo />;
  }
}`,...(_=(W=n.parameters)==null?void 0:W.docs)==null?void 0:_.source},description:{story:`No dedicated "Disabled" story: a table of data has no meaningful
disabled state of its own — the closest analogs (a disabled bulk-action
button, a disabled pagination control) are already covered by
\`Button\`'s own \`Disabled\` story.
[8.11.2]'s classes list: rows expand inline to reveal each class's
sections, rather than navigating away.`,...(q=($=n.parameters)==null?void 0:$.docs)==null?void 0:q.description}}};var K,G,H;p.parameters={...p.parameters,docs:{...(K=p.parameters)==null?void 0:K.docs,source:{originalSource:`{
  render: () => <Demo tableId="students-rtl" caption="শিক্ষার্থীগণ" columns={[{
    id: 'name',
    header: 'নাম',
    accessorFn: row => row.name,
    sortable: true
  }, {
    id: 'className',
    header: 'শ্রেণি',
    accessorFn: row => row.className
  }]} />,
  decorators: [rtlDecorator]
}`,...(H=(G=p.parameters)==null?void 0:G.docs)==null?void 0:H.source}}};const ze=["Default","Loading","Empty","ErrorState","Selectable","WithColumnsMenu","ExpandableRows","RightToLeft"];export{c as Default,m as Empty,r as ErrorState,n as ExpandableRows,i as Loading,p as RightToLeft,u as Selectable,o as WithColumnsMenu,ze as __namedExportsOrder,Ue as default};
