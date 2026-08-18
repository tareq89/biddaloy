# Graph Report - .  (2026-08-19)

## Corpus Check
- 410 files · ~303,823 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4143 nodes · 9392 edges · 267 communities (205 shown, 62 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 204 edges (avg confidence: 0.78)
- Token cost: 473,963 input · 0 output

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
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 223
- Community 224
- Community 225
- Community 226
- Community 227
- Community 228
- Community 229
- Community 230
- Community 231
- Community 232
- Community 233
- Community 234
- Community 235
- Community 236
- Community 237
- Community 238
- Community 239
- Community 240
- Community 241
- Community 242
- Community 243
- Community 244
- Community 249
- Community 250
- Community 251
- Community 254
- Community 256
- Community 257
- Community 258
- Community 259

## God Nodes (most connected - your core abstractions)
1. `Student` - 75 edges
2. `User` - 57 edges
3. `cn()` - 55 edges
4. `ClassSection` - 48 edges
5. `Class` - 44 edges
6. `School` - 43 edges
7. `AcademicYear` - 42 edges
8. `Guardian` - 37 edges
9. `StudentFee` - 35 edges
10. `AuditService` - 33 edges

## Surprising Connections (you probably didn't know these)
- `Multi-Tenancy Rules (Biddaloy)` --references--> `apiClient`  [EXTRACTED]
  .claude/skills/multi-tenancy/SKILL.md → ui/src/api/client.ts
- `Documentation Style Guidelines` --conceptually_related_to--> `Architecture Docs Index`  [INFERRED]
  CLAUDE.md → docs/architecture/README.md
- `Serena Project Config` --conceptually_related_to--> `Biddaloy CLAUDE.md`  [AMBIGUOUS]
  .serena/project.yml → CLAUDE.md
- `apiClient axios instance (X-Tenant-ID, X-Role, 401 refresh)` --shares_data_with--> `Multi-Tenancy Rules (Biddaloy)`  [INFERRED]
  ui/README.md → .claude/skills/multi-tenancy/SKILL.md
- `client-admin index.html` --semantically_similar_to--> `client-student index.html`  [INFERRED] [semantically similar]
  client-admin/index.html → client-student/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Caveman Mode Documentation Set** — claude_skills_caveman_readme, claude_skills_caveman_skill, claude_skills_caveman_readme_caveman_mode [EXTRACTED 1.00]
- **Communication Channels Implementing CommunicationProvider** — docs_architecture_05_communications_sms, docs_architecture_05_communications_whatsapp, docs_architecture_05_communications_messenger, docs_architecture_05_communications_email, docs_architecture_05_communications_provider_adapter [EXTRACTED 1.00]
- **Fee Generation to Payment to Invoice Lifecycle** — docs_architecture_01_domain_model_feestructure, docs_architecture_01_domain_model_studentfee, docs_architecture_01_domain_model_payment, docs_architecture_01_domain_model_paymentallocation, docs_architecture_01_domain_model_invoice [EXTRACTED 1.00]
- **Login & Session Security Layers** — docs_architecture_08_security_login_lockout, docs_architecture_08_security_refresh_token_rotation, docs_architecture_08_security_access_token_denylist, docs_architecture_08_security_csrf_posture, docs_architecture_08_security_same_origin_guard, docs_architecture_08_security_audit_trail [EXTRACTED 1.00]
- **@biddaloy/shared Cross-Package Consumption** — shared_readme_doc, server_readme_sanitization, client_student_readme_viteconfig, design_sync_conventions_statusbadge_tones [INFERRED 0.85]
- **Design-System Wrapper Boundary Pattern** — ui_contributing_wrapperrule, ui_src_primitives_readme_doc, ui_readme_doc, ui_contributing_threefile_requirement [INFERRED 0.85]
- **Multi-Tenant Scoping Enforced Across Stack** — claude_skills_multi_tenancy_skill_doc, server_claude_testingstandards, ui_readme_apiclient, ui_readme_hooks [INFERRED 0.85]

## Communities (267 total, 62 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (52): supertest, API_VERSION, buildVersioningOptions(), AppModule, Module, buildCorsOptions(), resolveCorsOrigins(), buildDocsBasicAuthMiddleware() (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (60): Calendar(), CalendarProps, DatePicker(), DatePickerProps, daysInMonth(), sameDay(), Default, Empty (+52 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (53): IsBoolean, CreateFeeStructureDto, CreatePaymentDto, FeeDuesSortBy, GenerateFeesResultDto, GenerateStudentFeesDto, PaymentAllocationInputDto, QueryFeeDuesDto (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (51): ApiHideProperty, TeacherClassSection, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (49): Check, PaymentAllocation, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne (+41 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (28): Class, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (34): routeTree, setAccessToken(), authDefaultHandlers, authHandlers, login, loginInvalidCredentials, loginRateLimited, loginResponseFactory() (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (45): AppShell(), AppShellNavItem, AppShellProps, navItems, InputProps, Label(), LabelProps, LOCALE_LABELS (+37 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (54): axe-core, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-import, eslint-plugin-jsx-a11y, eslint-plugin-react, eslint-plugin-react-hooks (+46 more)

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (32): AuditEntry, auditEntryFactory(), BD_MOBILE_PREFIXES, BN_DISTRICTS, BN_FEMALE_FIRST_NAMES, BN_LAST_NAMES, BN_MALE_FIRST_NAMES, bnAddress() (+24 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (35): SchoolSettingsPage(), clearAuthState(), currentSessionGeneration(), getAccessToken(), getActiveRole(), getActiveTenant(), notifySessionExpired(), registerSessionExpiredHandler() (+27 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (45): FeeStructure, feeStructureFactory(), StudentFee, Teacher, teacherFactory(), userResponseFactory(), auditLogDefaultHandlers, auditLogHandlers (+37 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (32): JoinTable, ResolvedRecipient, ResolvedSingleRecipient, InjectRepository, GuardianInput, DEFAULTS, Guardian, Column (+24 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (34): ConnectionTestResultMessage(), ConnectionTestResultMessageProps, MutationErrorMessage(), SecretField(), SecretFieldProps, EmailConfig, EmailFormValues, emailSchema (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (27): SettingsRoute(), COMMON_NAMESPACE, createI18nInstance(), whenReady(), I18nProvider(), I18nProviderProps, clearPersistedLocale(), DEFAULT_LOCALE (+19 more)

### Community 15 - "Community 15"
Cohesion: 0.10
Nodes (33): CreateTeacherDto, CreateUserDto, QueryTeacherDto, QueryUserDto, IsArray, IsDateString, IsEmail, IsEnum (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (36): Default, Disabled, Error, IconOnly, Loading, meta, RightToLeft, Story (+28 more)

### Community 17 - "Community 17"
Cohesion: 0.10
Nodes (37): EmailSectionProps, MessengerSectionProps, SmsSectionProps, Route, StudentDetailPage(), CreatePaymentInput, Payment, paymentKeys (+29 more)

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (33): Dialog(), DialogClose(), DialogCloseProps, DialogContent(), DialogContentProps, DialogDescription(), DialogDescriptionProps, DialogFooter() (+25 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (33): Select(), SelectContent(), SelectContentProps, SelectGroup(), SelectGroupProps, SelectItem(), SelectItemProps, SelectLabel() (+25 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (28): Checkbox(), DropdownMenu(), DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuGroup(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioGroup() (+20 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (28): RegionalFormValues, regionalSchema, RegionalSectionProps, RegionConfig, splitList(), Button(), FormControl(), FormDescription() (+20 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (20): Processor, CommunicationsModule, Module, CommunicationProvider, CommunicationProviderRegistry, CommunicationProviderRegistryService, Injectable, SmtpEmailProvider (+12 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (37): @biddaloy/ui, devDependencies, rollup-plugin-visualizer, tailwindcss, @tailwindcss/vite, @tanstack/react-query-devtools, @tanstack/react-router-devtools, @tanstack/router-plugin (+29 more)

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (15): @nestjs/swagger, ApiTenantAuth(), TestController, requestContext, CurrentTenant, CurrentUser, TestController, Roles() (+7 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (19): VALIDATION_OPTIONS, TENANT_SETTINGS_SCHEMA_VERSION, TenantSettingsDto, REQUEST_CONTEXT, OptionalSetting(), IsRegexSourceConstraint, ValidatorConstraint, SmsProviderIsConfiguredConstraint (+11 more)

### Community 26 - "Community 26"
Cohesion: 0.11
Nodes (36): AcademicYear, AuditLog, Class, ClassSection, CommunicationLog, Enrollment, FeeStructure, FeeStructureStudent (+28 more)

### Community 27 - "Community 27"
Cohesion: 0.12
Nodes (20): ApiBody, ApiConsumes, StudentController, ApiOperation, ApiTags, ApiTenantAuth, Body, Controller (+12 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (26): IsObject, TestConnectionDto, IsIn, IsOptional, TESTABLE_MEDIA, TestableCommunicationMedium, ConnectionTestService, Injectable (+18 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (24): DestinationBlockedError, OutboundDestinationError, assertResolvesToPublicAddress(), assertSafeHttpDestination(), assertSafeSmtpDestination(), DestinationBlockedError, DestinationResolutionError, ipv4ToInt() (+16 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (14): ACCESS_TOKEN_DENYLIST_REDIS, AccessTokenDenylistService, Inject, Injectable, AuthResult, ACCESS_TOKEN_TTL_MS, LoginAttemptResult, IssuedRefreshToken (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (20): formatViolations(), JSDOM_AXE_OPTIONS, Matchers, toHaveNoViolations(), vitest, mockOnlineStatus(), resetOnlineStatus(), DEFAULT_REGION (+12 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (22): Route, Route, Route, RootLayout(), Route, RouterContext, Route, FeesRoute (+14 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (28): AuditAction, CommunicationMedium, CommunicationStatus, CommunicationTrigger, EnrollmentStatus, FeeApplicability, FeeStatus, FeeType (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (16): Catch, buildErrorResponseBody(), ErrorResponseBody, resolveDetailMessage(), resolveStatus(), AllExceptionsFilter, applyRedaction(), redactPii() (+8 more)

### Community 35 - "Community 35"
Cohesion: 0.10
Nodes (21): Header, Audited(), InvoicesController, toSafeInvoice(), ApiOperation, ApiTags, ApiTenantAuth, Body (+13 more)

### Community 36 - "Community 36"
Cohesion: 0.08
Nodes (20): Optional, AuditService, RecordAuditEntryInput, Injectable, InjectRepository, AuditLog, Column, CreateDateColumn (+12 more)

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (19): FailOpenThrottlerStorage, Injectable, buildRateLimitTracker(), AuditModule, Module, ClassModule, Module, EnrollmentModule (+11 more)

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (21): COMMUNICATIONS_QUEUE, SkippedGuardianDto, addressForMedium(), DISPATCHABLE_MEDIA, selectReminderGuardians(), findUnsupportedPlaceholders(), formatDueAmount(), formatDueMonth() (+13 more)

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (28): entry, ignoreDependencies, project, entry, project, ignoreIssues, ui/eslint-config.mjs, ui/tailwind.preset.ts (+20 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (16): ClassService, SectionService, Injectable, CreateClassDto, CreateSectionDto, QueryClassDto, IsInt, IsNotEmpty (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.18
Nodes (13): ResolvedGreenwebSmsConfig, ResolvedMimSmsConfig, COMMUNICATION_PROVIDER_REGISTRY, CommunicationSendResult, ConnectionTestResult, normalizeBdPhoneNumber(), fetchPinnedJson(), GreenwebSmsGateway (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.07
Nodes (27): axios, class-variance-authority, clsx, i18next, i18next-resources-to-backend, lucide-react, react-i18next, react-router (+19 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (27): axios-mock-adapter, msw, msw-storybook-addon, storybook, @storybook/addon-a11y, @storybook/addon-essentials, @storybook/addon-interactions, @storybook/blocks (+19 more)

### Community 44 - "Community 44"
Cohesion: 0.10
Nodes (20): SanitizeAllowlist(), SanitizeText(), shared, AllowlistDto, { sanitizeAllowlist, sanitizeStrict }, StrictDto, CreateAcademicYearDto, IsBeforeConstraint (+12 more)

### Community 45 - "Community 45"
Cohesion: 0.08
Nodes (24): InjectQueue, InjectRepository, CommunicationLog, Column, CreateDateColumn, Entity, Index, JoinColumn (+16 more)

### Community 46 - "Community 46"
Cohesion: 0.17
Nodes (11): ProviderNotConfiguredError, EmailOverride, MessengerOverride, ResolvedMessengerConfig, ResolvedSmsConfig, ResolvedWhatsAppConfig, SmsOverride, WhatsAppOverride (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.17
Nodes (12): EncryptionService, isEncryptedEnvelope(), Injectable, decryptSecretFields(), encryptSecretFields(), reencryptSecretFields(), resolveParent(), transformAtPaths() (+4 more)

### Community 48 - "Community 48"
Cohesion: 0.10
Nodes (26): paths, ../ui/src, ../ui/src/api/index.ts, ../ui/src/hooks/index.ts, ../ui/src/i18n/index.ts, ../ui/src/styles/globals.css, ../ui/src/test/index.ts, ../ui/src/test/msw/enable-mocking.ts (+18 more)

### Community 49 - "Community 49"
Cohesion: 0.16
Nodes (26): NestedSettings, OptionalSetting, Secret, CommunicationsSettingsDto, EmailSettingsDto, GreenwebSmsDto, MessengerSettingsDto, MimSmsDto (+18 more)

### Community 50 - "Community 50"
Cohesion: 0.08
Nodes (26): scripts, api:types, build:all, build:client-admin, build:client-student, build:server, build:shared, build:ui (+18 more)

### Community 51 - "Community 51"
Cohesion: 0.18
Nodes (16): ClassController, ApiOperation, ApiTags, ApiTenantAuth, Body, Controller, CurrentTenant, Delete (+8 more)

### Community 52 - "Community 52"
Cohesion: 0.13
Nodes (9): SchoolsService, Injectable, InjectRepository, isPlainObject(), pickPatchShape(), redactSecretPaths(), CacheEntry, TenantSettingsCache (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (15): ArrayMaxSize, MAX_BULK_REMINDER_STUDENTS, ReminderBatchResponseDto, SendBulkReminderDto, SkippedRecipientDto, ArrayNotEmpty, IsArray, IsEnum (+7 more)

### Community 54 - "Community 54"
Cohesion: 0.08
Nodes (21): AuditController, ApiOperation, ApiResponse, ApiTags, ApiTenantAuth, Controller, CurrentTenant, Get (+13 more)

### Community 55 - "Community 55"
Cohesion: 0.12
Nodes (17): CreateEnrollmentDto, IsEnum, IsOptional, IsUUID, UpdateEnrollmentDto, EnrollmentController, ApiTags, ApiTenantAuth (+9 more)

### Community 56 - "Community 56"
Cohesion: 0.10
Nodes (21): StatusBadge five-tone status vocabulary, StatusBadge unauthored floor card build bug, Shared domain enums (FeeStatus, UserRole, etc.), COMMUNICATION_STATUS_TONE, ENROLLMENT_STATUS_TONE, FEE_STATUS_TONE, humanize(), INVOICE_STATUS_TONE (+13 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (24): @nestjs/cli, @nestjs/testing, devDependencies, @nestjs/cli, @nestjs/testing, supertest, ts-node, tsconfig-paths (+16 more)

### Community 58 - "Community 58"
Cohesion: 0.11
Nodes (18): Combobox(), ComboboxOption, ComboboxProps, CLASS_OPTIONS, Default, Empty, meta, NoResults (+10 more)

### Community 59 - "Community 59"
Cohesion: 0.15
Nodes (16): AcademicYearController, ApiOperation, ApiTags, ApiTenantAuth, Body, Controller, CurrentTenant, Delete (+8 more)

### Community 60 - "Community 60"
Cohesion: 0.13
Nodes (15): AcademicYearModule, Module, AcademicYearService, Injectable, InjectRepository, AcademicYear, Column, CreateDateColumn (+7 more)

### Community 61 - "Community 61"
Cohesion: 0.23
Nodes (22): BD_PHONE_REGEX, BulkUploadErrorDto, BulkUploadRowDto, CreateGuardianDto, CreateStudentDto, QueryGuardianDto, QueryStudentDto, IsArray (+14 more)

### Community 62 - "Community 62"
Cohesion: 0.09
Nodes (22): scripts, build, db:clear, db:reset, docs:generate, lint, migration:generate, migration:revert (+14 more)

### Community 63 - "Community 63"
Cohesion: 0.15
Nodes (16): RequireRole(), RequireRoleProps, forbiddenRoute, reportsRoute, rootRoute, routeTree, StudentsListRoute(), studentsRoute (+8 more)

### Community 64 - "Community 64"
Cohesion: 0.16
Nodes (11): collectErrorPaths(), RHF_ERROR_METADATA_KEYS, FormSection(), FormSectionProps, FormShell(), FormShellError, FormShellProps, WizardShell() (+3 more)

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (12): queryClient, Register, router, @tanstack/react-router, App(), worker, wsPassthrough, enableMocking() (+4 more)

### Community 66 - "Community 66"
Cohesion: 0.21
Nodes (15): CommunicationsController, ApiOperation, ApiTags, ApiTenantAuth, Body, Controller, CurrentTenant, Get (+7 more)

### Community 67 - "Community 67"
Cohesion: 0.15
Nodes (14): ReminderPreviewRecipientDto, ReminderPreviewResponseDto, SendSingleReminderDto, SentReminderRecipientDto, SingleReminderResponseDto, IsArray, IsEnum, IsNotEmpty (+6 more)

### Community 68 - "Community 68"
Cohesion: 0.16
Nodes (10): decodeMonthOrdinal(), DueEntry, FeeDuesService, GuardianContact, OPEN_STATUSES, sortAggregates(), StudentDueAggregate, StudentDueSnapshot (+2 more)

### Community 69 - "Community 69"
Cohesion: 0.15
Nodes (16): SchoolsController, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiTenantAuth, Body, Controller (+8 more)

### Community 70 - "Community 70"
Cohesion: 0.14
Nodes (14): ClassRef, getNestedType(), NESTED_TYPE_METADATA_KEY, NestedSettings(), isSecretProperty(), Secret(), SECRET_METADATA_KEY, ClassRef (+6 more)

### Community 71 - "Community 71"
Cohesion: 0.10
Nodes (20): CommunicationsSettings, CurrencyGrouping, CurrencyPosition, EmailSettings, GreenwebSmsSettings, MessengerSettings, MimSmsSettings, NumeralSystem (+12 more)

### Community 72 - "Community 72"
Cohesion: 0.15
Nodes (16): Default, meta, RightToLeft, Story, Tooltip(), TooltipContent(), TooltipContentProps, TooltipProps (+8 more)

### Community 73 - "Community 73"
Cohesion: 0.13
Nodes (18): AdmissionFormWithAutosave(), admissionSchema, AdmissionValues, Default, DraftRestore, ErrorSummary, meta, RightToLeft (+10 more)

### Community 74 - "Community 74"
Cohesion: 0.13
Nodes (19): Invoice, invoiceFactory(), Payment, paymentFactory(), create, fixtures, getOne, invoiceDefaultHandlers (+11 more)

### Community 75 - "Community 75"
Cohesion: 0.14
Nodes (19): Student, studentFactory(), create, Enrollment, enrollmentDefaultHandlers, enrollmentFactory(), enrollmentHandlers, listByStudent (+11 more)

### Community 76 - "Community 76"
Cohesion: 0.10
Nodes (20): dependencies, @biddaloy/shared, @hookform/resolvers, react, react-hook-form, @tanstack/react-query, @tanstack/react-router, zod (+12 more)

### Community 77 - "Community 77"
Cohesion: 0.10
Nodes (19): typescript, sanitize-html, typescript, dependencies, sanitize-html, devDependencies, @types/sanitize-html, typescript (+11 more)

### Community 78 - "Community 78"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+11 more)

### Community 79 - "Community 79"
Cohesion: 0.18
Nodes (6): RefreshTokenCleanupProcessor, Processor, hashSecret(), RefreshTokenService, safeEqualHex(), Injectable

### Community 80 - "Community 80"
Cohesion: 0.16
Nodes (12): Inject, CommunicationsService, toResponseDto(), Injectable, CommunicationResponseDto, SendCommunicationDto, IsArray, IsEnum (+4 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (18): FeeStructure, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne (+10 more)

### Community 82 - "Community 82"
Cohesion: 0.18
Nodes (6): StudentBulkUploadService, Injectable, BulkUploadResultDto, Inject, GuardianService, Injectable

### Community 83 - "Community 83"
Cohesion: 0.11
Nodes (18): description, main, name, private, scripts, api:types, build-storybook, check:api-types (+10 more)

### Community 84 - "Community 84"
Cohesion: 0.16
Nodes (14): extractCallSites(), flattenKeys(), loadNamespaces(), main(), pkgRoot, PLURAL_SUFFIXES, relativeTo(), repoRoot (+6 more)

### Community 85 - "Community 85"
Cohesion: 0.16
Nodes (12): DataTable(), DataTableColumn, DataTableProps, readPersistedState(), COLUMNS, Student, STUDENTS, ListShell() (+4 more)

### Community 86 - "Community 86"
Cohesion: 0.14
Nodes (18): Class, classFactory(), ClassSection, classSectionFactory(), classDefaultHandlers, classHandlers, create, createSection (+10 more)

### Community 87 - "Community 87"
Cohesion: 0.26
Nodes (13): ApiBearerAuth, ApiUnauthorizedResponse, Res, AuthController, ApiOperation, ApiTags, Body, Controller (+5 more)

### Community 88 - "Community 88"
Cohesion: 0.12
Nodes (18): client-admin/src/routes/login.tsx placeholder login route, design-sync conventions: styling idiom, I18nProvider wrapping requirement, styles.css compiled stylesheet as source of truth, cfg.cssEntry scratch copy of compiled CSS, Dialog/Menu/Tooltip set to cardMode: single, design-sync notes — @biddaloy/ui → Claude Design, Prior sync pushed _ds_sync.json without content actually landing (+10 more)

### Community 89 - "Community 89"
Cohesion: 0.12
Nodes (15): Default, meta, navItems, RightToLeft, Story, DeepLinkedStep, Default, InvalidFirstStep (+7 more)

### Community 90 - "Community 90"
Cohesion: 0.15
Nodes (12): RadioGroup(), RadioGroupItem(), RadioGroupItemProps, RadioGroupProps, Default, Disabled, Invalid, meta (+4 more)

### Community 91 - "Community 91"
Cohesion: 0.14
Nodes (15): CachedTabState, DeepLinkedTab, Default, meta, PermissionGated, RightToLeft, Story, StudentDetailPage() (+7 more)

### Community 92 - "Community 92"
Cohesion: 0.12
Nodes (16): react-dom, dependencies, react, react-dom, react, name, private, scripts (+8 more)

### Community 93 - "Community 93"
Cohesion: 0.16
Nodes (12): Route, StudentsListPage(), studentsSearchSchema, Placeholder(), Default, LocaleTextExpansion, meta, MswBackedData (+4 more)

### Community 94 - "Community 94"
Cohesion: 0.21
Nodes (9): mockIssuedRefreshToken, buildRefreshTokenClearCookieOptions(), buildRefreshTokenCookieOptions(), REFRESH_TOKEN_COOKIE, PROVIDER_TEST_RATE_LIMIT, RateLimitTierOptions, resolveDefaultRateLimit(), SETTINGS_RATE_LIMIT (+1 more)

### Community 96 - "Community 96"
Cohesion: 0.17
Nodes (17): CreateInvoiceDto, LineItemDto, QueryInvoiceDto, ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt (+9 more)

### Community 97 - "Community 97"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution (+8 more)

### Community 98 - "Community 98"
Cohesion: 0.14
Nodes (12): DEEP_IMPORT_PATTERNS, isStaticTemplateLiteral(), isStringLiteral(), noDeepUiImport, noHardcodedJsxText, noRadixImport, noRawIntl, pascalCase() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.12
Nodes (15): msw, workerDirectory, name, private, resolutions, js-yaml, version, workspaces (+7 more)

### Community 100 - "Community 100"
Cohesion: 0.12
Nodes (16): multer, vitest/globals, compilerOptions, baseUrl, emitDecoratorMetadata, experimentalDecorators, ignoreDeprecations, module (+8 more)

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (3): TenantProviderConfigResolver, Injectable, CommunicationSendParams

### Community 102 - "Community 102"
Cohesion: 0.17
Nodes (16): Accessibility expectations (color-alone rule, icon-only aria-label), Contributing to @biddaloy/ui, i18n rules for literal strings and lint enforcement, Three-file component requirement, Design token usage rule, Worked example: vendoring and wrapping Checkbox, The wrapper rule (vendored primitives, one wrapper each), apiClient axios instance (X-Tenant-ID, X-Role, 401 refresh) (+8 more)

### Community 103 - "Community 103"
Cohesion: 0.14
Nodes (11): contrastRatio(), css, cssPath, darkBody, errors, pkgRoot, relativeLuminance(), reverseLookup (+3 more)

### Community 104 - "Community 104"
Cohesion: 0.16
Nodes (10): FileUpload(), FileUploadItem, FileUploadProps, Default, Empty, ErrorState, Loading, meta (+2 more)

### Community 105 - "Community 105"
Cohesion: 0.18
Nodes (10): ButtonBaseProps, ButtonProps, Default, ErrorVariant, meta, Story, SuccessVariant, Toaster() (+2 more)

### Community 106 - "Community 106"
Cohesion: 0.22
Nodes (7): biddaloyReactConfig, componentBoundaryConfig, dataFetchingGuardConfig, financialMutationGuardConfig, typeCheckedRules, typeCheckedTestOverrides, here

### Community 107 - "Community 107"
Cohesion: 0.27
Nodes (4): Inject, AuthService, sleep(), Injectable

### Community 108 - "Community 108"
Cohesion: 0.15
Nodes (11): ignoreDependencies, @swc/core, @types/bcrypt, @types/supertest, unplugin-swc, @types/bcrypt, @types/supertest, @types/bcrypt (+3 more)

### Community 109 - "Community 109"
Cohesion: 0.27
Nodes (8): encryptionServiceFactory(), SchoolsModule, Module, buildEncryptionKey(), buildPreviousEncryptionKeys(), decodeKey(), VALID_KEY, WRONG_LENGTH_KEY

### Community 110 - "Community 110"
Cohesion: 0.15
Nodes (12): compilerOptions, composite, declaration, declarationMap, ignoreDeprecations, module, moduleResolution, outDir (+4 more)

### Community 111 - "Community 111"
Cohesion: 0.15
Nodes (13): exports, ./api, ./components, ./eslint-config, ./hooks, ./i18n, ./mocks, ./routes (+5 more)

### Community 112 - "Community 112"
Cohesion: 0.29
Nodes (5): ApiError, ApiErrorBody, createAppQueryClient(), handleGlobalQueryError(), i18n

### Community 113 - "Community 113"
Cohesion: 0.29
Nodes (8): ActivationKey, BUTTON_KEYS, describeElement(), expectKeyboardOperable(), expectTabOrder(), KEY_SEQUENCE, KeyboardOptions, LINK_KEYS

### Community 114 - "Community 114"
Cohesion: 0.18
Nodes (10): Checkbox(), CheckboxProps, Checked, Default, Disabled, Indeterminate, Invalid, meta (+2 more)

### Community 115 - "Community 115"
Cohesion: 0.15
Nodes (11): COLUMNS, Default, Empty, ErrorState, Loading, meta, RightToLeft, Selectable (+3 more)

### Community 116 - "Community 116"
Cohesion: 0.21
Nodes (12): AcademicYear, academicYearFactory(), academicYearDefaultHandlers, academicYearHandlers, create, fixtures, getOne, list (+4 more)

### Community 117 - "Community 117"
Cohesion: 0.18
Nodes (12): Multi-Tenancy Rules (Biddaloy), The One Rule: No Automatic Tenant Filter, PR Fix skill, --force-with-lease over --force rationale, code-review skill, Coverage targets by layer, Mandatory test scenarios (Tenant Isolation, Soft Deletes, Role Guards, Context Header), NestJS Testing Standards (+4 more)

### Community 118 - "Community 118"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, build:analyze, check:route-chunks, dev, lint (+3 more)

### Community 119 - "Community 119"
Cohesion: 0.18
Nodes (10): MinLength, EnvironmentVariables, NODE_ENVS, validConfig, IsIn, IsNotEmpty, IsOptional, IsString (+2 more)

### Community 120 - "Community 120"
Cohesion: 0.21
Nodes (12): dist, node_modules, exclude, dist, test, exclude, exclude, dist (+4 more)

### Community 121 - "Community 121"
Cohesion: 0.24
Nodes (5): AuditInterceptor, RequestWithTenant, Injectable, AUDITED_METADATA_KEY, AuditedMetadata

### Community 122 - "Community 122"
Cohesion: 0.18
Nodes (8): HasEmailOrPhoneConstraint, LoginDto, IsEmail, IsOptional, IsString, MinLength, Validate, ValidatorConstraint

### Community 123 - "Community 123"
Cohesion: 0.17
Nodes (10): InjectRepository, Enrollment, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne (+2 more)

### Community 124 - "Community 124"
Cohesion: 0.30
Nodes (11): MaskedCommunicationsSettingsResponseDto, MaskedEmailSettingsResponseDto, MaskedGreenwebSmsResponseDto, MaskedMessengerSettingsResponseDto, MaskedMimSmsResponseDto, MaskedSecretResponseDto, MaskedSmsSettingsResponseDto, MaskedWhatsAppSettingsResponseDto (+3 more)

### Community 125 - "Community 125"
Cohesion: 0.20
Nodes (9): Pagination(), PaginationProps, Default, Empty, FirstPage, LastPage, meta, RightToLeft (+1 more)

### Community 126 - "Community 126"
Cohesion: 0.51
Nodes (11): Overview, Domain Model, Auth & Multi-Tenancy, Backend Modules, Fees, Payments & Invoices, Communications (Reminders), Frontend Architecture, Deployment (+3 more)

### Community 127 - "Community 127"
Cohesion: 0.18
Nodes (10): RefreshToken, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn (+2 more)

### Community 128 - "Community 128"
Cohesion: 0.25
Nodes (6): REFRESH_TOKEN_CLEANUP_INTERVAL_MS, REFRESH_TOKEN_CLEANUP_JOB_ID, REFRESH_TOKEN_CLEANUP_QUEUE, RefreshTokenCleanupScheduler, Injectable, InjectQueue

### Community 129 - "Community 129"
Cohesion: 0.22
Nodes (10): Communication, communicationFactory(), communicationDefaultHandlers, communicationHandlers, getBulkReminder, getOne, previewReminder, send (+2 more)

### Community 130 - "Community 130"
Cohesion: 0.22
Nodes (10): Guardian, guardianFactory(), create, fixtures, guardianDefaultHandlers, guardianHandlers, list, listEmpty (+2 more)

### Community 131 - "Community 131"
Cohesion: 0.20
Nodes (9): compilerOptions, jsx, noEmit, outDir, rootDir, extends, include, src (+1 more)

### Community 132 - "Community 132"
Cohesion: 0.20
Nodes (10): lib, DOM, ES2022, lib, DOM, ES2022, lib, DOM (+2 more)

### Community 133 - "Community 133"
Cohesion: 0.27
Nodes (10): Student portal dev server (port 5173, /api proxy), @biddaloy/client-student README, Vite config: aliases and proxy highlights, Server architecture notes (API prefix, validation, CORS), @biddaloy/server README, Server environment variables table, Free-text sanitization via @SanitizeText / sanitizeStrict, server/src/main.ts static file serving logic (+2 more)

### Community 134 - "Community 134"
Cohesion: 0.20
Nodes (10): vite/client, compilerOptions, baseUrl, declaration, declarationMap, ignoreDeprecations, jsx, noEmit (+2 more)

### Community 135 - "Community 135"
Cohesion: 0.24
Nodes (7): ErrorState(), ErrorStateProps, CustomRetryLabel, Default, meta, RightToLeft, Story

### Community 136 - "Community 136"
Cohesion: 0.20
Nodes (8): ALL_STUDENTS, COLUMNS, Default, FilteredAndSorted, meta, Story, Student, WithSelection

### Community 137 - "Community 137"
Cohesion: 0.20
Nodes (9): biddaloyPreset, brand, CONTRAST_PAIRS, dark, light, neutral, radius, status (+1 more)

### Community 138 - "Community 138"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 139 - "Community 139"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 140 - "Community 140"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, noEmit, outDir, rootDir, extends, include, src

### Community 141 - "Community 141"
Cohesion: 0.22
Nodes (8): ../tsconfig.base.json, compilerOptions, exactOptionalPropertyTypes, noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters, strict, extends

### Community 142 - "Community 142"
Cohesion: 0.22
Nodes (8): prettier-plugin-tailwindcss, prettier-plugin-tailwindcss, plugins, printWidth, semi, singleQuote, tailwindStylesheet, trailingComma

### Community 143 - "Community 143"
Cohesion: 0.22
Nodes (8): ../shared/dist, test/*, paths, extends, include, src, @biddaloy/shared, @test/*

### Community 144 - "Community 144"
Cohesion: 0.22
Nodes (8): advisories, ALLOWLIST, expired, result, seen, { spawnSync }, today, unallowed

### Community 145 - "Community 145"
Cohesion: 0.36
Nodes (4): isOriginAllowed(), requestOrigin(), SameOriginGuard, Injectable

### Community 146 - "Community 146"
Cohesion: 0.42
Nodes (5): TeacherListResponseDto, TeacherResponseDto, ApiProperty, ApiProperty, UserResponseDto

### Community 147 - "Community 147"
Cohesion: 0.28
Nodes (6): EFFECT_HOOK_NAMES, findNetworkCall(), isNetworkCallCallee(), noFetchInEffect, ruleTester, walk()

### Community 148 - "Community 148"
Cohesion: 0.28
Nodes (6): findGuardedEndpointLiteral(), GUARDED_ENDPOINT_PATTERNS, matchesGuardedEndpoint(), noOptimisticFinancialMutation, ruleTester, walk()

### Community 149 - "Community 149"
Cohesion: 0.22
Nodes (6): CLASS_ATTRIBUTE_NAMES, INSET_REPLACEMENT, noPhysicalDirectionClasses, SPACING_REPLACEMENT, ruleTester, TEXT_ALIGN_REPLACEMENT

### Community 150 - "Community 150"
Cohesion: 0.39
Nodes (5): useSearchNavigate(), buildRouteTree(), Probe(), STEPS, useWizardShellStep()

### Community 151 - "Community 151"
Cohesion: 0.42
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 152 - "Community 152"
Cohesion: 0.25
Nodes (8): bullmq, class-transformer, nodemailer, dependencies, bullmq, class-transformer, @nestjs/swagger, nodemailer

### Community 153 - "Community 153"
Cohesion: 0.29
Nodes (6): buildLoginError(), LoginPage(), loginSearchSchema, SignInCredentials, SignInForm(), SignInFormError

### Community 154 - "Community 154"
Cohesion: 0.29
Nodes (5): AppController, Controller, Get, SkipThrottle, Version

### Community 155 - "Community 155"
Cohesion: 0.25
Nodes (6): QueryAcademicYearDto, IsInt, IsOptional, Max, Min, Type

### Community 156 - "Community 156"
Cohesion: 0.36
Nodes (6): ResolvedEmailConfig, isSmtpConnectionError(), mapSmtpError(), SMTP_CONNECTION_ERROR_CODES, withPinnedAddressFallback(), SafeSmtpDestination

### Community 157 - "Community 157"
Cohesion: 0.25
Nodes (3): ALLOWLIST, AllowlistEntry, JWT_AUTH_GUARD

### Community 158 - "Community 158"
Cohesion: 0.25
Nodes (7): entries, errors, exported, pkg, pkgRoot, PRIVATE_DIRS, srcDir

### Community 159 - "Community 159"
Cohesion: 0.39
Nodes (6): DataTableSort, ListShellActions, ListShellState, buildRouteTree(), Probe(), useListShellState()

### Community 160 - "Community 160"
Cohesion: 0.32
Nodes (5): Skeleton(), Default, meta, RowOfFields, Story

### Community 161 - "Community 161"
Cohesion: 0.29
Nodes (7): client-admin index.html, client-admin/src/main.tsx entry point, client-admin/src/routes/__root.tsx beforeLoad session guard, client-student index.html, client-student/src/main.tsx entry point, Session bootstrap and token refresh (session.ts), @/primitives alias breaking client-admin bundle ([8.7.3])

### Community 162 - "Community 162"
Cohesion: 0.29
Nodes (6): compilerOptions, types, extends, include, node, **/*.ts

### Community 163 - "Community 163"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, plugins, $schema, sourceRoot

### Community 164 - "Community 164"
Cohesion: 0.29
Nodes (6): compilerOptions, rootDir, extends, include, src, ./tsconfig.json

### Community 165 - "Community 165"
Cohesion: 0.33
Nodes (5): scripts, tailwind.preset.ts, extends, include, src

### Community 166 - "Community 166"
Cohesion: 0.53
Nodes (4): fakeCache(), fakeConfig(), fakeSchools(), resolverWith()

### Community 167 - "Community 167"
Cohesion: 0.33
Nodes (5): compilerOptions, rootDir, extends, include, src

### Community 168 - "Community 168"
Cohesion: 0.53
Nodes (5): decodeResidualEntitiesForPlainText(), normalize(), RESIDUAL_ENTITIES, sanitizeAllowlist(), sanitizeStrict()

### Community 169 - "Community 169"
Cohesion: 0.33
Nodes (5): checkedIn, fresh, openapiJson, pkgRoot, tmpDir

### Community 170 - "Community 170"
Cohesion: 0.33
Nodes (5): assetsDir, dest, matches, pkgRoot, repoRoot

### Community 171 - "Community 171"
Cohesion: 0.33
Nodes (5): components, $defs, operations, paths, webhooks

### Community 173 - "Community 173"
Cohesion: 0.33
Nodes (3): coverage, testSetupFile, uiAlias

### Community 174 - "Community 174"
Cohesion: 0.40
Nodes (3): jsxRuleTester, ruleTester, typedRuleTester

### Community 175 - "Community 175"
Cohesion: 0.40
Nodes (5): Biddaloy CLAUDE.md, Documentation Style Guidelines, RTK (Rust Token Killer), Serena Project Config, Server CLAUDE.md (testing standards)

### Community 176 - "Community 176"
Cohesion: 0.70
Nodes (5): Caveman Skill README, Caveman Mode (compressed communication), Caveman SKILL.md Instructions, Auto-Clarity Rule, Caveman Intensity Levels (lite/full/ultra/wenyan)

### Community 177 - "Community 177"
Cohesion: 0.40
Nodes (5): @biddaloy/shared, @biddaloy/shared, paths, ../shared/src, @biddaloy/shared

### Community 178 - "Community 178"
Cohesion: 0.40
Nodes (5): Access Token Denylist, Audit Trail, Column-Level Encryption (Deferred), Login Brute-Force Protection, Refresh Token Rotation & Reuse Detection

### Community 179 - "Community 179"
Cohesion: 0.40
Nodes (4): ESLINT_PACKAGES, eslintBin, filesByPackage, repoRoot

### Community 180 - "Community 180"
Cohesion: 0.50
Nodes (3): AuditLogListResponseDto, AuditLogResponseDto, ApiProperty

### Community 182 - "Community 182"
Cohesion: 0.50
Nodes (3): EXPECTED_ROUTE_CHUNKS, outDir, projectRoot

### Community 183 - "Community 183"
Cohesion: 0.50
Nodes (4): Docker Compose Services, Docker Compose Topology, CI Pipeline, knip Dead-Code Detection

### Community 184 - "Community 184"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 197 - "Community 197"
Cohesion: 0.67
Nodes (3): ../ui/src/components/index.ts, @biddaloy/ui/components, @biddaloy/ui/components

### Community 198 - "Community 198"
Cohesion: 0.67
Nodes (3): ../ui/src/routes/index.ts, @biddaloy/ui/routes, @biddaloy/ui/routes

### Community 199 - "Community 199"
Cohesion: 0.67
Nodes (3): ../ui/src/shells/index.ts, @biddaloy/ui/shells, @biddaloy/ui/shells

### Community 200 - "Community 200"
Cohesion: 0.67
Nodes (3): ../ui/src/utils/index.ts, @biddaloy/ui/utils, @biddaloy/ui/utils

### Community 201 - "Community 201"
Cohesion: 0.67
Nodes (3): ContextGuard, Role-Based Access Control (RBAC), Tenant Header Contract (@ApiTenantAuth)

### Community 203 - "Community 203"
Cohesion: 0.67
Nodes (3): Dependabot config, npm minor-and-patch update group, PR #59 (nodemailer major bump)

### Community 204 - "Community 204"
Cohesion: 0.67
Nodes (3): Global, AuthModule, Module

## Ambiguous Edges - Review These
- `Biddaloy CLAUDE.md` → `Serena Project Config`  [AMBIGUOUS]
  .serena/project.yml · relation: conceptually_related_to

## Knowledge Gaps
- **920 isolated node(s):** `Story`, `Matchers`, `Permission`, `JwtPayload`, `LoginResponse` (+915 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **62 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Biddaloy CLAUDE.md` and `Serena Project Config`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `supertest` connect `Community 0` to `Community 8`, `Community 57`, `Community 108`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 57` to `Community 184`, `Community 108`, `Community 77`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `supertest` connect `Community 57` to `Community 0`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `Story`, `Matchers`, `Permission` to the rest of the system?**
  _920 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0540045766590389 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0516404581634634 - nodes in this community are weakly interconnected._