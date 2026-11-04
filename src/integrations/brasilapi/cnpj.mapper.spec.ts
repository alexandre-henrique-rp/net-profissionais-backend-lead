import type { CnpjData } from './cnpj.types.js';
import { mapCnpjToLeadInput, mapCompanySize } from './cnpj.mapper.js';

/**
 * Mapeador puro do payload da BrasilAPI — nenhum I/O, nenhum mock: é a
 * tradução de texto livre da Receita para o enum do produto e para o shape do
 * modal de cadastro híbrido.
 */
describe('cnpj.mapper', () => {
  describe('mapCompanySize', () => {
    it('mapeia ME e MEI para ME', () => {
      expect(mapCompanySize('ME')).toBe('ME');
      expect(mapCompanySize('MEI')).toBe('ME');
      expect(mapCompanySize('mei')).toBe('ME');
      expect(mapCompanySize('Micro Empresa')).toBe('ME');
      expect(mapCompanySize('MICROEMPRESA')).toBe('ME');
    });

    it('mapeia EPP e "Pequeno Porte" para EPP', () => {
      expect(mapCompanySize('EPP')).toBe('EPP');
      expect(mapCompanySize('epp')).toBe('EPP');
      expect(mapCompanySize('Empresa de Pequeno Porte')).toBe('EPP');
    });

    it('mapeia DEMAIS para DEMAIS', () => {
      expect(mapCompanySize('DEMAIS')).toBe('DEMAIS');
      expect(mapCompanySize('Demais')).toBe('DEMAIS');
    });

    it('devolve null para porte ausente, vazio ou desconhecido', () => {
      // Divergência consciente do "esperado ingênuo": porte desconhecido NÃO
      // vira DEMAIS — inventar porte distorceria o filtro `company_size` do
      // Pool. Só o rótulo literal "DEMAIS" mapeia para o enum DEMAIS.
      expect(mapCompanySize(undefined)).toBeNull();
      expect(mapCompanySize(null)).toBeNull();
      expect(mapCompanySize('')).toBeNull();
      expect(mapCompanySize('   ')).toBeNull();
      expect(mapCompanySize('GRANDE')).toBeNull();
    });
  });

  describe('mapCnpjToLeadInput', () => {
    it('deriva o setor oficial a partir do CNAE principal @spec:AC-179', () => {
      expect(mapCnpjToLeadInput({ cnae_fiscal: 4321500 }).sector).toBe(
        'CONSTRUCAO',
      );
    });

    it('não quebra quando o QSA está ausente, nulo ou vazio', () => {
      expect(
        mapCnpjToLeadInput({ razao_social: 'Solar Tech' }).contacts,
      ).toEqual([]);
      expect(
        mapCnpjToLeadInput({ razao_social: 'Solar Tech', qsa: null }).contacts,
      ).toEqual([]);
      expect(
        mapCnpjToLeadInput({ razao_social: 'Solar Tech', qsa: [] }).contacts,
      ).toEqual([]);
    });

    it('extrai os sócios do QSA como decisores, descartando quem não tem nome', () => {
      const mapped = mapCnpjToLeadInput({
        qsa: [
          {
            nome_socio: '  Marcelo Dias  ',
            qualificacao_socio: 'Sócio-Diretor',
          },
          { nome_socio: null, qualificacao_socio: 'Sócio' },
          { qualificacao_socio: 'Sócio' },
          { nome_socio: '   ' },
        ],
      });

      expect(mapped.contacts).toEqual([
        { name: 'Marcelo Dias', role: 'Sócio-Diretor', isDecisionMaker: true },
      ]);
    });

    it('converte campos ausentes em null, nunca em undefined', () => {
      const mapped = mapCnpjToLeadInput({});

      const scalarKeys = [
        'companyName',
        'tradeName',
        'primaryCnae',
        'cnaeDescription',
        'capitalSocial',
        'postalCode',
        'street',
        'number',
        'complement',
        'neighborhood',
        'city',
        'state',
        'companySize',
      ] as const;

      for (const key of scalarKeys) {
        expect(mapped[key]).toBeNull();
      }

      expect(mapped.contacts).toEqual([]);
      expect(mapped.sector).toBe('OUTROS');
      expect(Object.values(mapped).every((value) => value !== undefined)).toBe(
        true,
      );
    });

    it('converte capital_social em string para número', () => {
      expect(
        mapCnpjToLeadInput({ capital_social: '150000.50' }).capitalSocial,
      ).toBe(150000.5);
      expect(mapCnpjToLeadInput({ capital_social: 250000 }).capitalSocial).toBe(
        250000,
      );
      expect(
        mapCnpjToLeadInput({ capital_social: '' }).capitalSocial,
      ).toBeNull();
      expect(
        mapCnpjToLeadInput({ capital_social: 'nao-numerico' }).capitalSocial,
      ).toBeNull();
    });

    it('converte cnae_fiscal numérico em string e o texto em descrição', () => {
      expect(
        mapCnpjToLeadInput({
          cnae_fiscal: 4321500,
          cnae_fiscal_descricao: 'Instalação elétrica',
        }),
      ).toMatchObject({
        primaryCnae: '4321500',
        cnaeDescription: 'Instalação elétrica',
      });

      expect(mapCnpjToLeadInput({ cnae_fiscal: '4321500' }).primaryCnae).toBe(
        '4321500',
      );
      expect(mapCnpjToLeadInput({}).primaryCnae).toBeNull();
    });

    it('normaliza a UF para duas letras maiúsculas', () => {
      expect(mapCnpjToLeadInput({ uf: 'mg' }).state).toBe('MG');
      expect(mapCnpjToLeadInput({ uf: ' SP ' }).state).toBe('SP');
      expect(mapCnpjToLeadInput({ uf: '' }).state).toBeNull();
    });

    it('trata texto em branco como ausente', () => {
      const mapped = mapCnpjToLeadInput({
        razao_social: '   ',
        nome_fantasia: '',
        logradouro: '  ',
      });

      expect(mapped.companyName).toBeNull();
      expect(mapped.tradeName).toBeNull();
      expect(mapped.street).toBeNull();
    });

    it('mapeia o payload completo da Receita para o shape do modal @spec:AC-081', () => {
      const data: CnpjData = {
        cnpj: '33456789000102',
        razao_social: 'Solar Tech Engenharia LTDA',
        nome_fantasia: 'Solar Tech',
        cnae_fiscal: 4321500,
        cnae_fiscal_descricao: 'Instalação e manutenção elétrica',
        capital_social: '150000.00',
        cep: '30130-110',
        logradouro: 'Av. Afonso Pena',
        numero: '1500',
        complemento: 'Sala 402',
        bairro: 'Centro',
        municipio: 'Belo Horizonte',
        uf: 'MG',
        porte: 'EPP',
        qsa: [
          { nome_socio: 'Marcelo Dias', qualificacao_socio: 'Sócio-Diretor' },
        ],
      };

      expect(mapCnpjToLeadInput(data)).toEqual({
        companyName: 'Solar Tech Engenharia LTDA',
        tradeName: 'Solar Tech',
        primaryCnae: '4321500',
        cnaeDescription: 'Instalação e manutenção elétrica',
        capitalSocial: 150000,
        postalCode: '30130-110',
        street: 'Av. Afonso Pena',
        number: '1500',
        complement: 'Sala 402',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        sector: 'CONSTRUCAO',
        companySize: 'EPP',
        contacts: [
          {
            name: 'Marcelo Dias',
            role: 'Sócio-Diretor',
            isDecisionMaker: true,
          },
        ],
      });
    });
  });
});
