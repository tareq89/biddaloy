# Graph Report - .  (2026-07-17)

## Corpus Check
- Corpus is ~36,201 words - fits in a single context window. You may not need a graph.

## Summary
- 524 nodes · 653 edges · 46 communities (39 shown, 7 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40

## God Nodes (most connected - your core abstractions)
1. `User` - 29 edges
2. `Student` - 28 edges
3. `StudentFee` - 17 edges
4. `Guardian` - 17 edges
5. `ClassSection` - 16 edges
6. `Class` - 16 edges
7. `Payment` - 16 edges
8. `compilerOptions` - 16 edges
9. `FeeStructure` - 15 edges
10. `Invoice` - 15 edges

## Surprising Connections (you probably didn't know these)
- `RBAC Authorization (Role-Based Access Control)` --semantically_similar_to--> `CodeRabbit Configuration`  [INFERRED] [semantically similar]
  .hermes/plans/2026-07-15_120000-feature-plan.md → .coderabbit.yaml
- `AST-Based Structural Extraction` --semantically_similar_to--> `Code Review Automation`  [INFERRED] [semantically similar]
  .hermes/skills/graphify/SKILL.md → .coderabbit.yaml
- `PWA Mobile-Friendly Requirement` --rationale_for--> `Student Portal Client (Vite + React)`  [INFERRED]
  .hermes/plans/2026-07-15_120000-feature-plan.md → client-student/README.md
- `Vite Dev Proxy to NestJS Backend` --conceptually_related_to--> `NestJS Backend Server`  [INFERRED]
  client-student/README.md → server/README.md
- `Docker Compose Infrastructure (App + DB + Nginx)` --conceptually_related_to--> `NestJS Backend Server`  [INFERRED]
  docker-compose.yml → server/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fee Collection Pipeline** — _hermes_plans_2026_07_15_120000_feature_plan_fee_structure_entity, _hermes_plans_2026_07_15_120000_feature_plan_student_fee_entity, _hermes_plans_2026_07_15_120000_feature_plan_payment_entity, _hermes_plans_2026_07_15_120000_feature_plan_invoice_entity [INFERRED 0.95]
- **Academic Structure Hierarchy** — _hermes_plans_2026_07_15_120000_feature_plan_academic_year_entity, _hermes_plans_2026_07_15_120000_feature_plan_class_entity, _hermes_plans_2026_07_15_120000_feature_plan_class_section_entity, _hermes_plans_2026_07_15_120000_feature_plan_student_entity [INFERRED 0.95]
- **Fee Reminder Communication Flow** — _hermes_plans_2026_07_15_120000_feature_plan_student_entity, _hermes_plans_2026_07_15_120000_feature_plan_guardian_entity, _hermes_plans_2026_07_15_120000_feature_plan_communication_log_entity, _hermes_plans_2026_07_15_120000_feature_plan_reminder_batch_entity [INFERRED 0.95]
- **Graphify Skill Reference Documentation** — hermes_skills_graphify_references_add_watch, hermes_skills_graphify_references_exports, hermes_skills_graphify_references_github_and_merge, hermes_skills_graphify_references_hooks, hermes_skills_graphify_references_query, hermes_skills_graphify_references_transcribe, hermes_skills_graphify_references_update [EXTRACTED 1.00]

## Communities (46 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (35): AcademicYear, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, Class (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (26): AuditAction, CommunicationMedium, CommunicationStatus, CommunicationTrigger, EnrollmentStatus, FeeApplicability, FeeStatus, FeeType (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (28): dependencies, react, react-dom, devDependencies, tailwindcss, @tailwindcss/vite, @types/react, @types/react-dom (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (25): Code Review Automation, CodeRabbit Configuration, Path-Specific Review Instructions, Self-Contained Build Output Artifact, Global API Prefix (/api), Monorepo Implementation Plan, NestJS Backend Serving API and Static Clients, TypeORM with PostgreSQL (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (25): bcrypt, class-transformer, class-validator, @nestjs/common, @nestjs/config, @nestjs/core, @nestjs/platform-express, @nestjs/typeorm (+17 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (21): Graphify URL Ingest And Watch, Folder Watch, URL Ingest, Graphify Export Formats, Token Reduction Benchmark, FalkorDB Export, GraphML Export, MCP Server (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (20): AcademicYear Entity, AuditLog Entity, Bulk Student-Guardian Excel Upload, Class Entity, ClassSection Entity, CommunicationLog Entity, Multi-Channel Fee Reminder System, FeeStructure Entity (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (19): @nestjs/cli, @nestjs/testing, devDependencies, @nestjs/cli, @nestjs/testing, ts-node, tsconfig-paths, @types/bcrypt (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (18): dist, node_modules, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, module, moduleResolution (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (8): Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, User

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): name, private, scripts, build, db:clear, db:reset, lint, migration:generate (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (16): compilerOptions, jsx, lib, noEmit, outDir, paths, rootDir, extends (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (16): name, private, scripts, build:all, build:client-student, build:server, build:shared, dev:client-student (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (16): AuditAction, CommunicationMedium, CommunicationStatus, CommunicationTrigger, EnrollmentStatus, FeeApplicability, FeeStatus, FeeType (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (8): Catch, Injectable, AppModule, Module, AllExceptionsFilter, ValidationPipe, bootstrap(), seed()

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (13): JoinTable, Student, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (12): compilerOptions, composite, declaration, declarationMap, module, moduleResolution, outDir, rootDir (+4 more)

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (10): Check, StudentFee, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (11): Guardian, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToMany (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (10): Payment, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (9): Invoice, Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): main, name, private, scripts, build, build:watch, types, version

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (8): Teacher, Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (8): CommunicationLog, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (8): ReminderBatch, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (8): PaymentAllocation, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (7): AuditLog, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (7): FeeStructureStudent, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (6): Graphify Commit Hook And CLAUDE MD Integration, CLAUDE MD Integration, Git Post Commit Hook, Graphify Incremental Update And Cluster Only, Cluster Only Rerun, Incremental Update

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 31 - "Community 31"
Cohesion: 0.40
Nodes (4): dataSource, envPath, options, dbReset()

### Community 32 - "Community 32"
Cohesion: 0.40
Nodes (3): Controller, Get, AppController

### Community 33 - "Community 33"
Cohesion: 0.50
Nodes (4): IsNotEmpty, IsString, EnvironmentVariables, validate()

## Knowledge Gaps
- **195 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `Community 9` to `Community 15`, `Community 16`, `Community 19`, `Community 20`, `Community 21`, `Community 23`, `Community 24`, `Community 25`, `Community 27`, `Community 31`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `Student` connect `Community 16` to `Community 0`, `Community 9`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 24`, `Community 28`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `Guardian` connect `Community 19` to `Community 24`, `Community 9`, `Community 16`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `User` (e.g. with `dbReset()` and `seed()`) actually correct?**
  _`User` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _195 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06882591093117409 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09032258064516129 - nodes in this community are weakly interconnected._