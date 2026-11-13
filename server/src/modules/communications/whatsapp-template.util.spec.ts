import { CommunicationMedium } from '@biddaloy/shared';
import {
  DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE,
  resolveWhatsAppTemplate,
  whatsAppTemplateMetadata,
} from './whatsapp-template.util';

describe('whatsapp-template.util', () => {
  const vars = { student_name: 'Rahim', due_amount: '4,200.00' };

  it('is null for a non-WhatsApp medium or no template name', () => {
    expect(resolveWhatsAppTemplate(CommunicationMedium.SMS, vars, {})).toBeNull();
    expect(resolveWhatsAppTemplate(CommunicationMedium.WHATSAPP, vars, {})).toBeNull();
    expect(whatsAppTemplateMetadata(null)).toBeNull();
  });

  it('fills params in order, verbatim (no school word is injected), default language en', () => {
    const t = resolveWhatsAppTemplate(CommunicationMedium.WHATSAPP, vars, {
      whatsapp_template_name: 'fee_due',
      whatsapp_template_params: ['student_name', 'due_amount', 'nope'],
    });
    expect(t).toEqual({
      name: 'fee_due',
      language: DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE,
      params: ['Rahim', '4,200.00', ''],
    });
    expect(whatsAppTemplateMetadata(t)).toEqual({
      template_name: 'fee_due',
      template_language: 'en',
      template_params: ['Rahim', '4,200.00', ''],
    });
  });
});
