import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{B as r}from"./button-DtSgWxv7.js";import{c as d}from"./createLucideIcon-xFpSlqfg.js";/**
 * @license lucide-react v1.31.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],l=d("loader-circle",c);function m({loading:a=!1,iconOnly:t,disabled:i,children:o,...s}){const n=s.asChild?o:e.jsxs(e.Fragment,{children:[a&&e.jsx(l,{className:"animate-spin","aria-hidden":"true"}),o,a&&e.jsxs("span",{className:"sr-only","aria-live":"polite",children:[" ","Loading"]})]});return e.jsx(r,{disabled:i||a,"aria-busy":a||void 0,"data-loading":a||void 0,"data-icon-only":t||void 0,...s,children:n})}m.__docgenInfo={description:"",methods:[],displayName:"Button",props:{loading:{defaultValue:{value:"false",computed:!1},required:!1}}};export{m as B};
