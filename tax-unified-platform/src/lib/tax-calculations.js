const fmt = new Intl.NumberFormat('ko-KR');

export const formatWon = (value) => `${fmt.format(Math.round(value))}원`;
export const formatSignedWon = (value) => {
  const sign = value < 0 ? '-' : '';
  return `${sign}${formatWon(Math.abs(value))}`;
};

const floor10 = (value) => Math.floor(value / 10) * 10;
const rate100Over110 = 100 / 110;

export const earnedIncomeDeduction = (gross) => {
  if (gross <= 5_000_000) return gross * 0.7;
  if (gross <= 15_000_000) return 3_500_000 + (gross - 5_000_000) * 0.4;
  if (gross <= 45_000_000) return 7_500_000 + (gross - 15_000_000) * 0.15;
  if (gross <= 100_000_000) return 12_000_000 + (gross - 45_000_000) * 0.05;
  const deduction = 14_750_000 + (gross - 100_000_000) * 0.02;
  return Math.min(deduction, 20_000_000);
};

export const progressiveTax = (taxable) => {
  const brackets = [
    { limit: 14_000_000, rate: 0.06, deduction: 0 },
    { limit: 50_000_000, rate: 0.15, deduction: 1_260_000 },
    { limit: 88_000_000, rate: 0.24, deduction: 5_760_000 },
    { limit: 150_000_000, rate: 0.35, deduction: 15_440_000 },
    { limit: 300_000_000, rate: 0.38, deduction: 19_940_000 },
    { limit: 500_000_000, rate: 0.4, deduction: 25_940_000 },
    { limit: 1_000_000_000, rate: 0.42, deduction: 35_940_000 },
    { limit: Infinity, rate: 0.45, deduction: 65_940_000 },
  ];

  const bracket = brackets.find((item) => taxable <= item.limit) || brackets[brackets.length - 1];
  return taxable * bracket.rate - bracket.deduction;
};

export const calcCardTargets = (gross) => {
  if (!Number.isFinite(gross) || gross <= 0) {
    return {
      threshold: 0,
      baseTarget: 0,
      baseTargetCredit: 0,
      maxTarget: 0,
    };
  }

  const threshold = gross * 0.25;
  const baseCap = gross <= 70_000_000 ? 3_000_000 : 2_500_000;
  const extraCap = gross <= 70_000_000 ? 3_000_000 : 2_000_000;

  const baseTarget = threshold + baseCap / 0.3;
  const baseTargetCredit = threshold + baseCap / 0.15;
  const maxTarget = threshold + (baseCap + extraCap) / 0.4;

  return {
    threshold,
    baseTarget,
    baseTargetCredit,
    maxTarget,
  };
};

export const isActiveDependent = (dependent) =>
  dependent.age !== null || dependent.income !== null || dependent.disabled;

export const isEligibleDependent = (dependent) => {
  const income = dependent.income ?? 0;
  const incomeOk = income <= 1_000_000;
  if (!incomeOk) return false;

  if (dependent.disabled) return true;

  if (dependent.relation === 'spouse') return true;
  if (dependent.relation === 'parent' || dependent.relation === 'grandparent') {
    return dependent.age !== null && dependent.age >= 60;
  }
  if (dependent.relation === 'child' || dependent.relation === 'grandchild') {
    return dependent.age !== null && dependent.age <= 20;
  }
  if (dependent.relation === 'sibling') {
    return dependent.age !== null && (dependent.age <= 20 || dependent.age >= 60);
  }
  return true;
};

export const isChildForTaxCredit = (dependent) => {
  const income = dependent.income ?? 0;
  const isChildRelation = dependent.relation === 'child' || dependent.relation === 'grandchild';
  return (
    isChildRelation &&
    dependent.age !== null &&
    dependent.age >= 8 &&
    dependent.age <= 20 &&
    income <= 1_000_000
  );
};

export const calcCardDeduction = ({
  gross,
  credit,
  debit,
  market,
  culture,
  sports,
  cultureEligible,
  previousSpend,
}) => {
  const cultureAmount = cultureEligible ? culture + sports : 0;
  const total = credit + debit + market + cultureAmount;
  const threshold = gross * 0.25;

  if (total <= threshold || total === 0) {
    return {
      deduction: 0,
      breakdown: { credit: 0, debit: 0, market: 0, culture: 0 },
      meta: { total, threshold, eligible: 0, thresholdDeduction: 0, possible: 0 },
    };
  }

  const creditDed = credit * 0.15;
  const debitDed = debit * 0.3;
  const cultureDed = cultureAmount * 0.3;
  const marketDed = market * 0.4;

  let thresholdDeduction = 0;
  const midTotal = credit + debit + cultureAmount;
  const allTotal = midTotal + market;

  if (threshold <= credit) {
    thresholdDeduction = threshold * 0.15;
  } else if (threshold <= midTotal) {
    thresholdDeduction = credit * 0.15 + (threshold - credit) * 0.3;
  } else if (threshold <= allTotal) {
    thresholdDeduction = credit * 0.15 + (debit + cultureAmount) * 0.3 + (threshold - midTotal) * 0.4;
  } else {
    return {
      deduction: 0,
      breakdown: { credit: 0, debit: 0, market: 0, culture: 0 },
      meta: { total, threshold, eligible: 0, thresholdDeduction: 0, possible: 0 },
    };
  }

  const possible = Math.max(0, creditDed + debitDed + cultureDed + marketDed - thresholdDeduction);
  const baseCap = gross <= 70_000_000 ? 3_000_000 : 2_500_000;
  const extraCap = gross <= 70_000_000 ? 3_000_000 : 2_000_000;
  const categorySum = gross <= 70_000_000 ? cultureDed + marketDed : marketDed;

  if (possible <= baseCap) {
    return {
      deduction: possible,
      breakdown: { credit: creditDed, debit: debitDed, market: marketDed, culture: cultureDed },
      meta: { total, threshold, eligible: total - threshold, thresholdDeduction, possible, baseCap },
    };
  }

  const extraAmount = possible - baseCap;
  const categoryAdd = Math.min(extraAmount, categorySum, extraCap);
  const remaining = Math.max(0, extraAmount - categoryAdd);

  let consumptionIncrease = 0;
  if (previousSpend > 0) {
    const increase = total - previousSpend * 1.05;
    if (increase > 0) {
      consumptionIncrease = Math.min(increase * 0.1, 1_000_000);
    }
  }

  const consumptionAdd = Math.min(remaining, consumptionIncrease);
  const deduction = baseCap + categoryAdd + consumptionAdd;

  return {
    deduction,
    breakdown: { credit: creditDed, debit: debitDed, market: marketDed, culture: cultureDed },
    meta: {
      total,
      threshold,
      eligible: total - threshold,
      thresholdDeduction,
      possible,
      baseCap,
      categoryAdd,
      consumptionAdd,
    },
  };
};

export const calculateYearEndTax = (data) => {
  const annualSalary = Number(data.annual_salary) || 0;
  const nontaxableSalary = Number(data.nontaxable_salary) || 0;
  const useAnnualSalary = data.use_annual_salary;
  let gross = Number(data.gross_salary) || 0;
  
  if (useAnnualSalary && annualSalary > 0) {
    gross = Math.max(0, annualSalary - nontaxableSalary);
  }
  
  const withheldIncome = Number(data.withheld_income_tax) || 0;
  const withheldLocalProvided = data.withheld_local_provided;
  const withheldLocal = withheldLocalProvided ? (Number(data.withheld_local_tax) || 0) : withheldIncome * 0.1;

  const dependents = data.dependents || [];
  const activeDependents = dependents.filter(isActiveDependent);
  const eligibleDependents = activeDependents.filter(isEligibleDependent);
  const eligibleCount = eligibleDependents.length;
  const childCount = activeDependents.filter(isChildForTaxCredit).length;
  const eligibleChildDependents = eligibleDependents.filter(
    (d) => d.relation === 'child' || d.relation === 'grandchild'
  ).length;

  const baseDeduction = 1_500_000 * (1 + eligibleCount);
  const elderlyDeduction = eligibleDependents.filter((d) => d.age >= 70).length * 1_000_000;
  const disabledCount =
    (data.self_disabled ? 1 : 0) + eligibleDependents.filter((d) => d.disabled).length;
  const disabledDeduction = disabledCount * 2_000_000;
  const singleParentDeduction = data.single_parent && eligibleChildDependents > 0 ? 1_000_000 : 0;
  const femaleHeadDeduction =
    !data.single_parent && data.female_head && eligibleCount > 0 ? 500_000 : 0;
  const additionalDeduction =
    elderlyDeduction + disabledDeduction + femaleHeadDeduction + singleParentDeduction;

  const earnedDeduction = earnedIncomeDeduction(gross);
  const earnedIncome = Math.max(0, gross - earnedDeduction);

  const socialInsurance = Number(data.social_insurance) || 0;
  const creditSpend = Number(data.credit_card_spend) || 0;
  const debitSpend = Number(data.debit_card_spend) || 0;
  const marketSpend = Number(data.market_transport_spend) || 0;
  const cultureSpend = Number(data.culture_expenses) || 0;
  const sportsEligible = Number(data.sports_facility_fee_eligible) || 0;
  const previousCardSpend = Number(data.previous_card_spend) || 0;
  const cultureEligible = data.culture_eligible && gross <= 70_000_000;

  const card = calcCardDeduction({
    gross,
    credit: creditSpend,
    debit: debitSpend,
    market: marketSpend,
    culture: cultureSpend,
    sports: sportsEligible,
    cultureEligible,
    previousSpend: previousCardSpend,
  });

  const cardTargets = calcCardTargets(gross);
  const currentCardTotal = creditSpend + debitSpend + marketSpend + cultureSpend + sportsEligible;
  const additionalNeeded = Math.max(0, cardTargets.maxTarget - currentCardTotal);

  const housingSavings = Number(data.housing_savings) || 0;
  const housingSavingsEligible = data.housing_savings_eligible && gross <= 70_000_000;
  const housingSavingsRaw = housingSavingsEligible
    ? Math.min(housingSavings, 3_000_000) * 0.4
    : 0;
  const leaseLoanRepayment = Number(data.lease_loan_repayment) || 0;
  const leaseLoanEligible = data.lease_loan_eligible;
  const leaseLoanRaw = leaseLoanEligible ? leaseLoanRepayment * 0.4 : 0;
  const housingCombinedLimit = 4_000_000;
  const housingCombinedDeduction = Math.min(housingSavingsRaw + leaseLoanRaw, housingCombinedLimit);
  const housingSavingsDeduction = Math.min(housingSavingsRaw, housingCombinedDeduction);
  const leaseLoanDeduction = Math.min(
    leaseLoanRaw,
    Math.max(0, housingCombinedDeduction - housingSavingsDeduction)
  );

  const mortgageInterest = Number(data.mortgage_interest) || 0;
  const mortgageEligible = data.mortgage_eligible;
  const mortgageLimit = Number(data.mortgage_limit) || 0;
  const mortgageDeduction = mortgageEligible ? Math.min(mortgageInterest, mortgageLimit) : 0;

  const otherIncomeDeduction = Number(data.other_income_deduction) || 0;

  const incomeDeductionTotal =
    baseDeduction +
    additionalDeduction +
    socialInsurance +
    card.deduction +
    housingSavingsDeduction +
    leaseLoanDeduction +
    mortgageDeduction +
    otherIncomeDeduction;

  const taxableIncome = Math.max(0, earnedIncome - incomeDeductionTotal);
  const calculatedTax = Math.max(0, progressiveTax(taxableIncome));

  let earnedIncomeTaxCredit = Math.min(calculatedTax * 0.55, 1_300_000);
  if (calculatedTax > 1_300_000) {
    earnedIncomeTaxCredit = Math.min(
      earnedIncomeTaxCredit,
      715_000 + (calculatedTax - 1_300_000) * 0.3
    );
  }

  const earnedCreditCap =
    gross <= 33_000_000 ? 740_000 : gross <= 70_000_000 ? 660_000 : gross <= 120_000_000 ? 500_000 : 200_000;
  earnedIncomeTaxCredit = Math.min(earnedIncomeTaxCredit, earnedCreditCap);

  let childTaxCredit = 0;
  if (childCount === 1) childTaxCredit = 250_000;
  else if (childCount === 2) childTaxCredit = 550_000;
  else if (childCount >= 3) childTaxCredit = 550_000 + (childCount - 2) * 400_000;

  const birthCredit =
    (Number(data.birth_first) || 0) * 300_000 +
    (Number(data.birth_second) || 0) * 500_000 +
    (Number(data.birth_third) || 0) * 700_000;

  const marriageTaxCredit = data.marriage_credit ? 500_000 : 0;

  const pensionContribution = Number(data.pension_contribution) || 0;
  const isaTransfer = Number(data.isa_transfer) || 0;
  const pensionLimit = data.pension_with_irp ? 9_000_000 : 6_000_000;
  const isaEligible = Math.min(isaTransfer * 0.1, 3_000_000);
  const pensionEligible = Math.min(pensionContribution + isaEligible, pensionLimit);
  const pensionRate = gross <= 55_000_000 ? 0.15 : 0.12;
  const pensionTaxCredit = pensionEligible * pensionRate;

  const insurancePremium = Number(data.insurance_premiums) || 0;
  const insuranceRate = data.insurance_disabled ? 0.15 : 0.12;
  const insuranceTaxCredit = Math.min(insurancePremium, 1_000_000) * insuranceRate;

  const medicalGeneral = Number(data.medical_expenses) || 0;
  const medicalSpecial = Number(data.medical_special_expenses) || 0;
  const medicalInfertility = Number(data.medical_infertility) || 0;
  const medicalPremature = Number(data.medical_premature) || 0;
  const postnatalCare = Math.min(Number(data.postnatal_care) || 0, 2_000_000);
  const medicalReimbursements = Number(data.medical_reimbursements) || 0;

  let generalTotal = medicalGeneral + postnatalCare;
  let specialTotal = medicalSpecial;
  let infertilityTotal = medicalInfertility;
  let prematureTotal = medicalPremature;

  const medicalTotal = generalTotal + specialTotal + infertilityTotal + prematureTotal;
  if (medicalReimbursements > 0 && medicalTotal > 0) {
    const ratio = Math.min(1, medicalReimbursements / medicalTotal);
    generalTotal -= generalTotal * ratio;
    specialTotal -= specialTotal * ratio;
    infertilityTotal -= infertilityTotal * ratio;
    prematureTotal -= prematureTotal * ratio;
  }

  generalTotal = Math.max(0, generalTotal);
  specialTotal = Math.max(0, specialTotal);
  infertilityTotal = Math.max(0, infertilityTotal);
  prematureTotal = Math.max(0, prematureTotal);

  const medicalThreshold = gross * 0.03;
  let remainingThreshold = medicalThreshold;
  const generalUsed = Math.min(remainingThreshold, generalTotal);
  remainingThreshold -= generalUsed;
  const specialUsed = Math.min(remainingThreshold, specialTotal);
  remainingThreshold -= specialUsed;
  const prematureUsed = Math.min(remainingThreshold, prematureTotal);
  remainingThreshold -= prematureUsed;
  const infertilityUsed = Math.min(remainingThreshold, infertilityTotal);

  const generalEligible = Math.min(Math.max(0, generalTotal - generalUsed), 7_000_000);
  const specialEligible = Math.max(0, specialTotal - specialUsed);
  const prematureEligible = Math.max(0, prematureTotal - prematureUsed);
  const infertilityEligible = Math.max(0, infertilityTotal - infertilityUsed);

  const medicalTaxCredit =
    (generalEligible + specialEligible) * 0.15 +
    prematureEligible * 0.2 +
    infertilityEligible * 0.3;

  const educationCapPeople = Math.max(1, eligibleCount);
  const educationK12 = Math.min(Number(data.education_k12) || 0, 3_000_000 * educationCapPeople);
  const educationUniversity = Math.min(Number(data.education_university) || 0, 9_000_000);
  const educationSelf = Number(data.education_self) || 0;
  const educationTaxCredit = (educationK12 + educationUniversity + educationSelf) * 0.15;

  const donationsGeneral = Number(data.donations_general) || 0;
  const donationsReligious = Number(data.donations_religious) || 0;
  const donationsSpecial = Number(data.donations_special) || 0;
  const donationsEmployeeStock = Number(data.donations_employee_stock) || 0;

  const donationsPolitical = Number(data.donations_political) || 0;
  const politicalEligible = Math.min(donationsPolitical, earnedIncome);
  const politicalFirst = Math.min(politicalEligible, 100_000) * rate100Over110;
  const politicalRemaining = Math.max(0, politicalEligible - 100_000);
  const politicalSecond = Math.min(politicalRemaining, 30_000_000) * 0.15;
  const politicalThird = Math.max(0, politicalRemaining - 30_000_000) * 0.25;
  const donationsPoliticalCredit = politicalFirst + politicalSecond + politicalThird;

  const donationsHometown = Number(data.donations_hometown) || 0;
  const remainingAfterPolitical = Math.max(0, earnedIncome - politicalEligible);
  const hometownLimit = Math.min(20_000_000, remainingAfterPolitical);
  const hometownEligible = Math.min(donationsHometown, hometownLimit);
  const hometownFirst = Math.min(hometownEligible, 100_000) * rate100Over110;
  const hometownRemaining = Math.max(0, hometownEligible - 100_000);
  const hometownRate = data.donations_hometown_disaster ? 0.3 : 0.15;
  const donationsHometownCredit = hometownFirst + hometownRemaining * hometownRate;

  const remainingAfterHometown = Math.max(0, remainingAfterPolitical - hometownEligible);
  const donationSpecialEligible = Math.min(donationsSpecial, remainingAfterHometown);
  const remainingAfterSpecial = Math.max(0, remainingAfterHometown - donationSpecialEligible);
  const employeeLimit = remainingAfterSpecial * 0.3;
  const donationEmployeeEligible = Math.min(donationsEmployeeStock, employeeLimit);
  const remainingAfterEmployee = Math.max(0, remainingAfterSpecial - donationEmployeeEligible);

  let generalLimit = 0;
  let religiousLimit = 0;
  if (donationsReligious > 0) {
    religiousLimit = remainingAfterEmployee * 0.1;
    generalLimit = remainingAfterEmployee * 0.2;
  } else {
    generalLimit = remainingAfterEmployee * 0.3;
  }

  const donationGeneralEligible = Math.min(donationsGeneral, generalLimit);
  const donationReligiousEligible = Math.min(donationsReligious, religiousLimit);
  const donationsOtherEligible =
    donationSpecialEligible +
    donationEmployeeEligible +
    donationGeneralEligible +
    donationReligiousEligible;
  const donationsOtherCredit =
    Math.min(donationsOtherEligible, 10_000_000) * 0.15 +
    Math.max(0, donationsOtherEligible - 10_000_000) * 0.3;
  const donationsEmployeeCredit =
    Math.min(donationEmployeeEligible, 10_000_000) * 0.15 +
    Math.max(0, donationEmployeeEligible - 10_000_000) * 0.3;

  const rentPaid = Math.min(Number(data.rent_paid) || 0, 10_000_000);
  const rentEligible = data.rent_eligible && gross <= 80_000_000;
  const rentRate = gross <= 55_000_000 ? 0.17 : 0.15;
  const rentTaxCredit = rentEligible ? rentPaid * rentRate : 0;

  const standardTaxCredit = data.use_standard_credit ? 130_000 : 0;

  const otherTaxCredit = Number(data.other_tax_credit) || 0;

  const specialCreditsAllowed = !data.use_standard_credit;
  const appliedInsuranceCredit = specialCreditsAllowed ? insuranceTaxCredit : 0;
  const appliedMedicalCredit = specialCreditsAllowed ? medicalTaxCredit : 0;
  const appliedEducationCredit = specialCreditsAllowed ? educationTaxCredit : 0;
  const appliedGeneralDonationCredit = specialCreditsAllowed
    ? donationsOtherCredit
    : donationsEmployeeCredit;
  const appliedRentCredit = specialCreditsAllowed ? rentTaxCredit : 0;

  const totalTaxCredits =
    earnedIncomeTaxCredit +
    childTaxCredit +
    birthCredit +
    marriageTaxCredit +
    pensionTaxCredit +
    appliedInsuranceCredit +
    appliedMedicalCredit +
    appliedEducationCredit +
    appliedGeneralDonationCredit +
    donationsPoliticalCredit +
    donationsHometownCredit +
    appliedRentCredit +
    standardTaxCredit +
    otherTaxCredit;

  const determinedIncomeTaxRaw = Math.max(0, calculatedTax - totalTaxCredits);
  const determinedIncomeTax = Math.floor(determinedIncomeTaxRaw);
  const localTax = Math.floor(determinedIncomeTaxRaw * 0.1);
  const totalDeterminedTax = determinedIncomeTax + localTax;

  const withheldTotal = withheldIncome + withheldLocal;
  const refundAmount = withheldTotal - totalDeterminedTax;

  const outputs = {
    taxableIncome,
    calculatedTax,
    totalTaxCredits,
    determinedIncomeTax,
    localTax,
    totalDeterminedTax,
    refundAmount,
    earnedIncomeDeduction: earnedDeduction,
    basicDeduction: baseDeduction,
    additionalDeduction: additionalDeduction,
    socialInsuranceDeduction: socialInsurance,
    cardDeduction: card.deduction,
    cardThreshold: cardTargets.threshold,
    cardBaseTarget: cardTargets.baseTarget,
    cardBaseTargetCredit: cardTargets.baseTargetCredit,
    cardMaxTarget: cardTargets.maxTarget,
    cardAdditionalNeeded: additionalNeeded,
    housingSavingsDeduction: housingSavingsDeduction,
    leaseLoanDeduction: leaseLoanDeduction,
    mortgageDeduction: mortgageDeduction,
    otherIncomeDeduction: otherIncomeDeduction,
    incomeDeductionTotal,
    earnedIncomeTaxCredit,
    childTaxCredit,
    birthTaxCredit: birthCredit,
    marriageTaxCredit,
    pensionTaxCredit,
    insuranceTaxCredit: appliedInsuranceCredit,
    medicalTaxCredit: appliedMedicalCredit,
    educationTaxCredit: appliedEducationCredit,
    donationsGeneralCredit: appliedGeneralDonationCredit,
    donationsPoliticalCredit,
    donationsHometownCredit,
    rentTaxCredit: appliedRentCredit,
    standardTaxCredit,
    otherTaxCredit,
    withheldIncomeTax: withheldIncome,
    withheldLocalTax: withheldLocal,
    withheldTotalTax: withheldTotal,
  };

  const warnings = [];
  if (gross > 70_000_000) {
    warnings.push('총급여 7,000만 초과 시 카드 공제 한도/문화비 공제 적용이 달라질 수 있습니다.');
  }
  if (!cultureEligible && (cultureSpend > 0 || sportsEligible > 0)) {
    warnings.push('문화비·체육시설 공제는 총급여 7,000만 이하에서만 적용되므로 해당 금액은 일반 사용액에 포함하세요.');
  }
  if (card.meta && card.meta.total > 0 && card.meta.total <= card.meta.threshold) {
    warnings.push('카드 사용액이 총급여의 25% 미만이면 신용카드 소득공제가 적용되지 않습니다.');
  }
  if (data.single_parent && data.female_head) {
    warnings.push('한부모 공제와 부녀자 공제는 중복 적용되지 않아 한부모 공제로 계산됩니다.');
  }
  if (donationsPolitical > politicalEligible) {
    warnings.push('정치자금기부금은 근로소득금액 한도까지만 공제됩니다.');
  }
  if (donationsHometown > hometownLimit) {
    warnings.push('고향사랑기부금 세액공제는 근로소득금액 범위 내 2,000만 원 한도까지만 적용됩니다.');
  }
  if (donationsSpecial > donationSpecialEligible) {
    warnings.push('특례기부금은 정치·고향 차감 후 근로소득금액 한도까지만 공제됩니다.');
  }
  if (donationsEmployeeStock > employeeLimit) {
    warnings.push('우리사주조합 기부금은 근로소득금액의 30% 한도까지만 공제됩니다.');
  }
  if (donationsGeneral > generalLimit || donationsReligious > religiousLimit) {
    warnings.push('일반·종교 기부금은 한도(종교 10% + 일반 20% 또는 30%)까지만 공제됩니다.');
  }
  if (housingSavingsRaw + leaseLoanRaw > housingCombinedLimit) {
    warnings.push('주택청약저축과 주택임차차입금 공제는 합산 400만 한도 적용됩니다.');
  }
  if (useAnnualSalary && annualSalary > 0) {
    warnings.push('총급여는 연봉(비과세 포함)에서 비과세소득을 차감해 자동 계산되었습니다.');
  }
  if (data.use_standard_credit) {
    warnings.push('표준세액공제를 선택하면 보험료·의료비·교육비·월세·특례/일반/종교 기부금은 제외되며 정치자금·우리사주·고향사랑 기부금만 반영됩니다. 일부 지정기부금의 중복 가능 여부는 별도 확인이 필요합니다.');
  }

  return {
    outputs,
    warnings,
    meta: {
      gross,
      withheldLocalProvided,
      withheldLocal,
      withheldIncome,
    },
  };
};

/* -----------------------------------------
   Corporate Tax Logic (Ported from corporate/index.html)
   ----------------------------------------- */
   
export const normalizeEntityType = (raw) => {
  const upper = (raw || "").toString().toUpperCase();
  if (upper !== "SME" && upper !== "GENERAL") {
    // Default to SME if unknown, or throw error depending on strictness
    return "SME";
  }
  return upper === "SME" ? "SME" : "GENERAL";
};

export const calculateDeemedInterest = (overdraftRate, advances, interestPaid) => {
  const raw = (overdraftRate || 0) * (advances || 0) - (interestPaid || 0);
  return Math.max(0, Math.round(raw));
};

export const calculateDeemedRent = (profile, financialData) => {
  if (financialData.deemedRentOverride) return financialData.deemedRentOverride;
  if (!profile.isRealEstateRental) return 0;
  if (profile.debt == null || profile.equity == null) return 0;
  if (profile.debt <= 2 * profile.equity) return 0;
  const excessDebt = profile.debt - 2 * profile.equity;
  const proxyRate = financialData.overdraftRate || 0;
  return Math.round(excessDebt * proxyRate);
};

export const isLargeUnlisted = (profile) => {
  if (profile.equity == null) return false;
  return profile.equity > 50_000_000_000;
};

export const progressiveRevenueLimit = (revenue) => {
  const brackets = [
    [10_000_000_000, 0.003],
    [50_000_000_000, 0.002],
    [null, 0.0003]
  ];
  let remaining = revenue;
  let prevCap = 0;
  let total = 0;
  for (const [cap, rate] of brackets) {
    const slice = cap === null ? remaining : Math.max(0, Math.min(remaining, cap - prevCap));
    total += slice * rate;
    remaining -= slice;
    prevCap = cap ?? prevCap;
    if (remaining <= 0) break;
  }
  return total;
};

export const calculateBusinessPromotionLimit = (entityType, bpInput, revenue) => {
  const baseLimit = entityType === "SME" ? 36_000_000 : 12_000_000;
  const revenueLimitGeneral = progressiveRevenueLimit(revenue.general);
  const revenueLimitRelated = 0.1 * progressiveRevenueLimit(revenue.relatedParty);
  const revenueLimit = Math.round(revenueLimitGeneral + revenueLimitRelated);
  const mainLimit = baseLimit + revenueLimit;
  const culturalBonus = Math.round(Math.min(bpInput.cultural, mainLimit * 0.2));
  const marketBonus = Math.round(Math.min(bpInput.market, mainLimit * 0.1));
  const deductibleCap = mainLimit + culturalBonus + marketBonus;
  const allowableBase = Math.max(0, bpInput.total - bpInput.noProof);
  const deductible = Math.round(Math.min(allowableBase, deductibleCap));
  const nonDeductible = bpInput.total - deductible;
  return {
    baseLimit,
    revenueLimit,
    culturalBonus,
    marketBonus,
    deductibleCap,
    deductible,
    nonDeductible
  };
};

export const calculateVehicleDepreciation = (vehicles) => {
  const limit = (vehicles.count || 0) * 8_000_000;
  const allowed = Math.min(vehicles.depreciation || 0, limit);
  return {
    allowed,
    disallowed: (vehicles.depreciation || 0) - allowed,
    limit
  };
};

export const calculateGeneralDepreciation = (dep) => {
  if (dep.statutoryLimit == null) {
    return { allowed: dep.claimed || 0, disallowed: 0, limit: dep.claimed || 0 };
  }
  const allowed = Math.min(dep.claimed || 0, dep.statutoryLimit);
  return { allowed, disallowed: (dep.claimed || 0) - allowed, limit: dep.statutoryLimit };
};

export const calculateRevenueAdjustments = (profile, financialData) => {
  const deemedInterest = calculateDeemedInterest(
    financialData.overdraftRate,
    financialData.advancesToRelated,
    financialData.interestPaid
  );
  const deemedRent = calculateDeemedRent(profile, financialData);
  let excessRetained = 0;
  if (financialData.excessRetainedOverride) {
    excessRetained = financialData.excessRetainedOverride;
  } else if (isLargeUnlisted(profile)) {
    excessRetained = 0; // 구체식 부재 시 0 유지
  }
  const total = deemedInterest + deemedRent + excessRetained;
  return { deemedInterest, deemedRent, excessRetained, total };
};

export const calculateExpenseAdjustments = (entityType, financialData) => {
  const bp = calculateBusinessPromotionLimit(
    entityType,
    financialData.expenses.businessPromotion,
    financialData.revenue
  );
  const vehicle = calculateVehicleDepreciation(financialData.expenses.vehicles);
  const generalDep = calculateGeneralDepreciation(financialData.expenses.generalDepreciation);
  const nonBusiness = financialData.expenses.nonBusiness || 0;
  const totalNonDeductible =
    bp.nonDeductible + vehicle.disallowed + generalDep.disallowed + nonBusiness;
  return { businessPromotion: bp, vehicle, generalDep, nonBusiness, totalNonDeductible };
};

export const lossCapRate = (entityType) => {
  return entityType === "SME" ? 1.0 : 0.8;
};

export const lossExpired = (loss, filingYear) => {
  const allowedYears = loss.originYear < 2020 ? 10 : 15;
  return filingYear - loss.originYear >= allowedYears;
};

export const rateTableForYear = (rateTable, filingYear) => {
  const preset = (rateTable || "").toString();
  if (preset === "2021" || preset === "2018-2022") {
    return [
      [200_000_000, 0.10, 0],
      [20_000_000_000, 0.20, 20_000_000],
      [300_000_000_000, 0.21, 420_000_000],
      [null, 0.24, 9_420_000_000]
    ];
  }
  // default 2023~2025 (README 기준)
  return [
    [200_000_000, 0.09, 0],
    [20_000_000_000, 0.19, 20_000_000],
    [300_000_000_000, 0.21, 420_000_000],
    [null, 0.24, 9_420_000_000]
  ];
};

export const applyLossCarryforward = (taxableBeforeLoss, loss, entityType, filingYear) => {
  if (taxableBeforeLoss <= 0) {
    return { applied: 0, remaining: loss.totalAvailable, expired: lossExpired(loss, filingYear), allowedRate: lossCapRate(entityType) };
  }
  const expired = lossExpired(loss, filingYear);
  if (expired) {
    return { applied: 0, remaining: loss.totalAvailable, expired: true, allowedRate: lossCapRate(entityType) };
  }
  const capRate = lossCapRate(entityType);
  const capAmount = taxableBeforeLoss * capRate;
  const applied = Math.round(Math.min(loss.totalAvailable, capAmount));
  const remaining = loss.totalAvailable - applied;
  return { applied, remaining, expired: false, allowedRate: capRate };
};

export const calculateProgressiveTax = (taxBase, rateTable) => {
  for (const [cap, rate, deduction] of rateTable) {
    if (cap === null || taxBase <= cap) {
      return Math.round(taxBase * rate - deduction);
    }
  }
  return 0;
};

export const calculateRDCredit = (rd, entityType) => {
  if (entityType === "SME") {
    const baseCredit = rd.current * 0.25;
    const incremental = rd.increment * 0.5;
    return Math.max(baseCredit, incremental);
  }
  const baseRate = rd.baseRate == null ? 0.02 : Math.max(0, Math.min(rd.baseRate, 0.02));
  const baseCredit = rd.current * baseRate;
  const incremental = rd.increment * 0.25;
  return Math.max(baseCredit, incremental);
};

export const calculateInvestmentCredit = (inv, entityType) => {
  const baseRate = entityType === "SME" ? 0.10 : 0.01;
  const base = inv.current * baseRate;
  const increase = Math.max(0, inv.current - inv.avgThreeYear);
  const additional = increase * 0.03;
  return base + additional;
};

export const calculateDonations = (baseIncome, donations) => {
  const specialTotal = (donations.specialCarry || 0) + (donations.specialCurrent || 0);
  const generalTotal = (donations.generalCarry || 0) + (donations.generalCurrent || 0);
  const base = Math.max(0, baseIncome);
  const specialRate = donations.specialLimitRate == null ? 0.5 : Number(donations.specialLimitRate);
  const generalRate = donations.generalLimitRate == null ? 0.1 : Number(donations.generalLimitRate);
  // 법정기부금: 소득금액의 specialRate
  const specialLimit = base * specialRate;
  const allowedSpecial = Math.min(specialTotal, specialLimit);
  const remainingBase = Math.max(0, base - allowedSpecial);
  // 지정기부금: 법정기부금 손금산입 후 잔여 소득금액의 generalRate
  const generalLimit = remainingBase * generalRate;
  const allowedGeneral = Math.min(generalTotal, generalLimit);
  const nonDeductible = specialTotal + generalTotal - allowedSpecial - allowedGeneral;
  return {
    allowedSpecial,
    allowedGeneral,
    nonDeductible,
    specialLimit,
    generalLimit
  };
};

export const calculateTonnageBase = (payload) => {
  if (payload.shippingMode !== "tonnage") return 0;
  if (payload.shippingTonnageBase && payload.shippingTonnageBase > 0) {
    return payload.shippingTonnageBase;
  }
  const ships = payload.tonnageShips || [];
  return ships.reduce((sum, ship) => {
    const ton = ship.tonnage || 0;
    const days = ship.days || 0;
    const rate = ship.rate || 0;
    return sum + ton * days * rate;
  }, 0);
};

export const calculateCredits = (calculatedTax, credits, entityType) => {
  let remaining = calculatedTax;
  const rdCreditRaw = calculateRDCredit(credits.rd, entityType);
  const rdCredit = Math.round(Math.min(rdCreditRaw, remaining));
  remaining -= rdCredit;
  const invCreditRaw = calculateInvestmentCredit(credits.investment, entityType);
  const investmentCredit = Math.round(Math.min(invCreditRaw, remaining));
  remaining -= investmentCredit;
  const otherCredit = Math.round(Math.min(credits.other || 0, remaining));
  remaining -= otherCredit;
  const foreignTaxCredit = Math.round(Math.min(credits.foreignTax || 0, remaining));
  remaining -= foreignTaxCredit;

  return {
    rdCredit,
    investmentCredit,
    otherCredit,
    foreignTaxCredit,
    total: rdCredit + investmentCredit + otherCredit + foreignTaxCredit,
    remainingAfterGeneralCredits: remaining
  };
};

export const minimumTaxRate = (entityType, taxBase) => {
  if (entityType === "SME") return 0.07;
  if (taxBase <= 10_000_000_000) return 0.10;
  if (taxBase <= 100_000_000_000) return 0.12;
  return 0.17;
};

export const calculateMinimumTax = (taxBase, entityType, roundingMode) => {
  const raw = taxBase * minimumTaxRate(entityType, taxBase);
  if (roundingMode === "floor") return Math.floor(raw);
  return Math.round(raw);
};

export const calculateCorporateTax = (payload) => {
  const entityType = normalizeEntityType(payload.companyProfile.type);
  const revenueAdj = calculateRevenueAdjustments(payload.companyProfile, payload.financialData);
  const expenseAdj = calculateExpenseAdjustments(entityType, payload.financialData);
  const brackets = rateTableForYear(payload.rateTable, payload.filingYear);
  const rateLabel =
    payload.rateTable === "2021" || payload.rateTable === "2018-2022"
      ? "2018~2022 세율표(1구간 10%)"
      : "2023~2025 세율표(1구간 9%)";
  const roundingMode = payload.roundingMode || "round";

  const manualAdditions =
    (payload.adjustments.manualIncomeAdd || 0) +
    (payload.adjustments.manualExpenseDisallow || 0);
  const manualDeductions =
    (payload.adjustments.manualIncomeExclude || 0) +
    (payload.adjustments.manualExpenseAllow || 0);

  const preDonationTaxable =
    payload.financialData.netIncome +
    revenueAdj.total +
    expenseAdj.totalNonDeductible +
    manualAdditions -
    manualDeductions;
  const donationResult = calculateDonations(preDonationTaxable, payload.donations || {});

  const totalAdditions =
    revenueAdj.total + expenseAdj.totalNonDeductible + donationResult.nonDeductible + manualAdditions;
  const totalDeductions = manualDeductions;
  let taxableBeforeLoss = payload.financialData.netIncome + totalAdditions - totalDeductions;

  const tonnageBase = calculateTonnageBase(payload);
  if (tonnageBase > 0) {
    taxableBeforeLoss = tonnageBase;
  }

  const lossResult = applyLossCarryforward(
    taxableBeforeLoss,
    payload.adjustments.lossCarryforward,
    entityType,
    payload.filingYear
  );

  const taxBase = Math.max(0, taxableBeforeLoss - lossResult.applied);
  const calculatedTax = calculateProgressiveTax(taxBase, brackets);
  const creditResult = calculateCredits(calculatedTax, payload.credits, entityType);
  const taxAfterCredits = Math.max(0, calculatedTax - creditResult.total);
  const minimumTax = calculateMinimumTax(taxBase, entityType, roundingMode);
  const preExemptTax = Math.max(taxAfterCredits, minimumTax);
  const exemptMinTaxCredit = Math.round(
    Math.min(payload.credits.exemptMinTax || 0, preExemptTax)
  );
  const finalTax = preExemptTax - exemptMinTaxCredit;
  const prepaidTax = payload.adjustments.prepaidTax || 0;
  const payableTax = finalTax - prepaidTax;

  return {
    entityType,
    residency: payload.residency,
    revenueAdj,
    expenseAdj,
    totalAdditions,
    totalDeductions,
    taxableBeforeLoss,
    lossResult,
    taxBase,
    calculatedTax,
    creditResult: { ...creditResult, exemptMinTaxCredit },
    taxAfterCredits,
    minimumTax,
    finalTax,
    prepaidTax,
    payableTax,
    rateLabel,
    largeCorpOwnership: payload.companyProfile.largeCorpOwnership,
    donationResult,
    tonnageBase: tonnageBase
  };
};

/* -----------------------------------------
   Financial Tax Logic (Ported from financial/taxEngine.js)
   ----------------------------------------- */
   
export const FINANCIAL_RULES = {
  taxYear: 2024,
  financialThreshold: 20_000_000,
  grossUpRate: 0.1, 
  progressiveRates: [
    { threshold: 14_000_000, rate: 0.06, deduction: 0 },
    { threshold: 50_000_000, rate: 0.15, deduction: 1_260_000 },
    { threshold: 88_000_000, rate: 0.24, deduction: 5_760_000 },
    { threshold: 150_000_000, rate: 0.35, deduction: 15_440_000 },
    { threshold: 300_000_000, rate: 0.38, deduction: 19_940_000 },
    { threshold: 500_000_000, rate: 0.40, deduction: 25_940_000 },
    { threshold: 1_000_000_000, rate: 0.42, deduction: 35_940_000 },
    { threshold: null, rate: 0.45, deduction: 65_940_000 },
  ],
  localRate: 0.1,
  rentalSeparateThreshold: 20_000_000,
  rentalSeparateRate: 0.14,
  rentalStandardExpenseRate: 0.5,
  imputedDepositThreshold: 300_000_000,
  imputedInterestRate: 0.025,
  imputedDeductionRatio: 0.6,
  imputedMinHouseCount: 2,
  rounding: { tax: 1, payable: 10 },
};

const ensureNumber = (value) => {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

const toKRW = (value) => {
  return Math.floor(ensureNumber(value));
}

const floorToUnit = (value, unit = 1) => {
  if (!unit || unit <= 1) return Math.floor(value);
  return Math.floor(value / unit) * unit;
}

const normalizeRate = (value) => {
  const num = ensureNumber(value);
  if (num < 0) return 0;
  if (num > 1) return num / 100;
  return num;
}

const clampRatio = (value, label, warnings) => {
  if (value == null || !Number.isFinite(Number(value))) {
    warnings?.push(`${label}는 숫자여야 합니다. 0으로 처리합니다.`);
    return 0;
  }
  const num = Number(value);
  if (num < 0) {
    warnings?.push(`${label}는 음수일 수 없습니다. 0으로 조정합니다.`);
    return 0;
  }
  if (num > 1) return num / 100;
  return num;
}

const computeOtherIncome = (otherIncome = {}, rules) => {
  const warnings = [];
  const items = Array.isArray(otherIncome.items) ? otherIncome.items : [];
  if (!items.length) {
    const gross = toKRW(otherIncome.gross);
    return {
      gross,
      deductions: 0,
      taxable: Math.max(gross, 0),
      separateTax: 0,
      prepaid: 0,
      warnings,
    };
  }

  let grossSum = 0;
  let expenseSum = 0;
  let taxable = 0;
  let separateTax = 0;
  let prepaid = 0;
  let rentalSeparateUsed = 0;
  let rentalSeparateExcess = 0;
  const rentalThreshold = rules?.rentalSeparateThreshold ?? FINANCIAL_RULES.rentalSeparateThreshold;
  const rentalSepRateDefault = normalizeRate(rules?.rentalSeparateRate ?? FINANCIAL_RULES.rentalSeparateRate);
  const rentalStdExpenseRate = rules?.rentalStandardExpenseRate ?? FINANCIAL_RULES.rentalStandardExpenseRate ?? 0.5;
  const imputedThreshold = rules?.imputedDepositThreshold ?? FINANCIAL_RULES.imputedDepositThreshold;
  const imputedInterest = rules?.imputedInterestRate ?? FINANCIAL_RULES.imputedInterestRate;
  const imputedRatio = rules?.imputedDeductionRatio ?? FINANCIAL_RULES.imputedDeductionRatio ?? 0.6;
  const imputedMinHouseCount = rules?.imputedMinHouseCount ?? FINANCIAL_RULES.imputedMinHouseCount ?? 2;
  let imputedRentalIncome = 0;

  for (const item of items) {
    const gross = toKRW(item.amount);
    grossSum += gross;
    const mode = (item.expenseMode || 'standard').toLowerCase();
    const isRental = (item.type || '').toLowerCase() === 'rental';
    const rate = clampRatio(
      item.expenseRate ?? (isRental ? rentalStdExpenseRate : 0),
      'expenseRate',
      warnings,
    );
    const actual = toKRW(item.expenseAmount);
    const expense = mode === 'actual' ? Math.min(actual, gross) : Math.min(Math.floor(gross * rate), gross);
    expenseSum += expense;
    const taxableItem = Math.max(gross - expense, 0);

    let sepRate = item.separate ? normalizeRate(item.separateRate ?? item.withholdingRate ?? 0) : 0;
    if (isRental && sepRate === 0 && item.separate) sepRate = rentalSepRateDefault;

    if (sepRate > 0) {
        let sepAmount = taxableItem;
        if (isRental && rentalThreshold > 0) {
          const remaining = Math.max(rentalThreshold - rentalSeparateUsed, 0);
          sepAmount = Math.min(remaining, taxableItem);
          const toComprehensive = taxableItem - sepAmount;
        if (toComprehensive > 0) {
          rentalSeparateExcess += toComprehensive;
          taxable += toComprehensive;
          warnings.push('임대 분리과세 한도(20,000,000) 초과분은 종합과세로 전환됩니다.');
        }
        rentalSeparateUsed += sepAmount;
      }
      separateTax += sepAmount * sepRate;
    } else {
      taxable += taxableItem;
    }
    prepaid += toKRW(item.prepaidTax);

    if (isRental && item.deposit > 0 && (item.houseCount ?? imputedMinHouseCount) >= imputedMinHouseCount) {
      const deposit = toKRW(item.deposit);
      if (deposit > imputedThreshold) {
        const months = Number.isFinite(item.months) && item.months > 0 ? item.months : 12;
        const imputedBase = deposit - imputedThreshold;
        const imputed = imputedBase * imputedInterest * (months / 12) * imputedRatio;
        imputedRentalIncome += imputed;
      }
    }
  }

  return {
    gross: grossSum,
    deductions: expenseSum,
    taxable: taxable + imputedRentalIncome,
    separateTax,
    prepaid,
    rentalSeparateUsed,
    rentalSeparateExcess,
    imputedRentalIncome,
    warnings,
  };
}

const resolveRules = (settings = {}) => {
  const year = settings.taxYear ?? FINANCIAL_RULES.taxYear;
  const merged = {
    ...FINANCIAL_RULES,
    ...(settings.rules || {}),
  };
  merged.taxYear = year;
  if (settings.progressiveRates) merged.progressiveRates = settings.progressiveRates;
  if (settings.financialThreshold != null) merged.financialThreshold = settings.financialThreshold;
  if (settings.grossUpRate != null) merged.grossUpRate = settings.grossUpRate;
  if (settings.localRate != null) merged.localRate = settings.localRate;
  merged.rounding = {
    tax: settings.rounding?.tax ?? merged.rounding?.tax ?? 1,
    payable: settings.rounding?.payable ?? merged.rounding?.payable ?? 10,
  };
  return merged;
}

const computeProgressiveTaxFinancial = (base, brackets, roundingUnit = 1) => {
  const taxable = Math.max(ensureNumber(base), 0);
  let bracketUsed = brackets[brackets.length - 1];
  for (const b of brackets) {
    if (b.threshold === null || taxable <= b.threshold) {
      bracketUsed = b;
      break;
    }
  }
  const tax = taxable * bracketUsed.rate - bracketUsed.deduction;
  return {
    tax: floorToUnit(tax, roundingUnit),
    taxable,
    bracketUsed,
  };
}

const allocateFinancialThreshold = (financialIncomes = [], threshold) => {
  let remaining = threshold;
  const allocations = [];
  for (const item of financialIncomes) {
    const amount = toKRW(item.amount);
    const take = Math.max(Math.min(remaining, amount), 0);
    const excess = Math.max(amount - take, 0);
    remaining -= take;
    allocations.push({ ...item, amount, thresholdPortion: take, excessPortion: excess });
  }
  return allocations;
}

export const calculateFinancialTax = (input = {}) => {
  const warnings = [];
  const rules = resolveRules(input.settings || {});
  const progressiveRates = rules.progressiveRates;
  const roundingTax = rules.rounding.tax;
  const roundingPayable = rules.rounding.payable;
  const grossUpRate = rules.grossUpRate;
  const threshold = rules.financialThreshold;

  const financialIncomes = Array.isArray(input.financialIncomes) ? input.financialIncomes : [];
  const otherIncomeResult = computeOtherIncome(input.otherIncome, rules);
  warnings.push(...otherIncomeResult.warnings);
  const otherIncomeDeduction = toKRW(input.otherIncome?.deductions);
  const otherTaxableBase = otherIncomeResult.taxable;

  const withAlloc = allocateFinancialThreshold(financialIncomes, threshold);
  const financialTotal = withAlloc.reduce((sum, f) => sum + f.amount, 0);
  const separateFinancialTax = withAlloc.reduce(
    (sum, f) => sum + f.amount * normalizeRate(f.withholdingRate ?? 0.14),
    0,
  );
  const thresholdTax = withAlloc.reduce(
    (sum, f) => sum + f.thresholdPortion * normalizeRate(f.withholdingRate ?? 0.14),
    0,
  );
  const thresholdUsed = withAlloc.reduce((sum, f) => sum + f.thresholdPortion, 0);

  let excessFinancial = 0;
  let grossUpBase = 0;
  let foreignIncome = 0;
  let foreignTaxPaid = 0;
  let prepaidWithholding = 0;
  let forceComprehensive = false;

  for (const f of withAlloc) {
    const rate = normalizeRate(f.withholdingRate ?? 0.14);
    excessFinancial += f.excessPortion;
    if (f.grossUpEligible) grossUpBase += f.excessPortion;
    const source = (f.source || 'domestic').toLowerCase();
    if (source === 'foreign') {
      foreignIncome += f.amount;
      foreignTaxPaid += toKRW(f.foreignTaxPaid ?? f.prepaidTax);
      forceComprehensive = true; // 해외소득 있는 경우 종합과세 강제
    }
    prepaidWithholding += toKRW(f.prepaidTax ?? f.amount * rate);
  }

  const grossUpAmount = toKRW(grossUpBase * grossUpRate);
  const comprehensiveTaxableBaseBeforeDeductions = Math.max(otherTaxableBase + excessFinancial + grossUpAmount, 0);
  const otherTaxableBaseBeforeDeductions = Math.max(otherTaxableBase, 0);
  const comprehensiveTaxableBase = Math.max(comprehensiveTaxableBaseBeforeDeductions - otherIncomeDeduction, 0);
  const otherTaxableBaseAfterDeductions = Math.max(otherTaxableBaseBeforeDeductions - otherIncomeDeduction, 0);

  const progressiveComprehensive = computeProgressiveTaxFinancial(comprehensiveTaxableBase, progressiveRates, roundingTax);
  const progressiveOtherOnly = computeProgressiveTaxFinancial(otherTaxableBaseAfterDeductions, progressiveRates, roundingTax);

  const separateOtherTax = otherIncomeResult.separateTax;

  const methodATax = thresholdTax + progressiveComprehensive.tax + separateOtherTax;
  const methodBTax = separateFinancialTax + progressiveOtherOnly.tax + separateOtherTax;

  let comparisonNote = '';
  let chosenMethod = 'separate';
  let chosenTaxBeforeCredits = methodBTax;
  if (financialTotal > threshold || forceComprehensive) {
    chosenMethod = methodATax >= methodBTax ? 'comprehensive' : 'separate';
    chosenTaxBeforeCredits = Math.max(methodATax, methodBTax);
    comparisonNote = `비교과세 적용: 종합 ${Math.round(methodATax)} / 분리 ${Math.round(methodBTax)}`;
  } else {
    comparisonNote = '2천만원 이하 → 분리과세 선택';
  }

  // 배당세액공제 (단순화): Gross-up 금액 vs (종합 산출세액 - (다른소득 산출세액 + 금융소득 원천징수세액))
  let dividendCredit = 0;
  if (grossUpAmount > 0 && (financialTotal > threshold || forceComprehensive)) {
    const financialWithholdingTax = separateFinancialTax;
    const creditLimit = Math.max(progressiveComprehensive.tax - (progressiveOtherOnly.tax + financialWithholdingTax), 0);
    dividendCredit = Math.min(grossUpAmount, creditLimit);
  }

  // 외국납부세액공제 (단순화)
  let foreignTaxCredit = 0;
  if (foreignIncome > 0) {
    const totalIncomeForRatio = Math.max(otherIncomeResult.gross + excessFinancial, 1);
    const ratio = Math.min(foreignIncome / totalIncomeForRatio, 1);
    const creditLimit = chosenTaxBeforeCredits * ratio;
    foreignTaxCredit = Math.min(creditLimit, foreignTaxPaid);
  }

  const otherTaxCredit = toKRW(input.taxCredits?.other);

  const nationalTax = floorToUnit(
    Math.max(chosenTaxBeforeCredits - dividendCredit - foreignTaxCredit - otherTaxCredit, 0),
    roundingTax,
  );
  const localIncomeTax = floorToUnit(nationalTax * rules.localRate, roundingTax);

  const prepaidNational = toKRW(input.prepaid?.national) + prepaidWithholding;
  const prepaidLocal = toKRW(input.prepaid?.local);
  const totalPayableRaw =
    nationalTax + localIncomeTax - prepaidNational - prepaidLocal - otherIncomeResult.prepaid;
  const totalPayable = floorToUnit(totalPayableRaw, roundingPayable);

  const trace = [
    {
      step: 'Financial split',
      financialTotal,
      thresholdUsed,
      excessFinancial,
      grossUpBase,
      grossUpAmount,
      thresholdTax,
      separateFinancialTax,
      separateOtherTax,
      otherTaxableBase,
      otherIncomeDeduction,
      comprehensiveTaxableBaseBeforeDeductions,
      comprehensiveTaxableBaseAfterDeductions: comprehensiveTaxableBase,
      otherTaxableBaseBeforeDeductions,
      otherTaxableBaseAfterDeductions,
    },
    {
      step: 'Progressive',
      comprehensiveTaxableBase,
      progressiveComprehensive: progressiveComprehensive.tax,
      otherTaxableBase: otherTaxableBaseAfterDeductions,
      progressiveOtherOnly: progressiveOtherOnly.tax,
    },
    {
      step: 'Comparison',
      methodATax,
      methodBTax,
      chosenMethod,
      chosenTaxBeforeCredits,
      dividendCredit,
      foreignTaxCredit,
      otherTaxCredit,
      nationalTax,
      localIncomeTax,
      prepaidNational,
      prepaidLocal,
      totalPayable,
    },
  ];

  const result = {
    taxYear: rules.taxYear,
    chosenMethod,
    comparisonNote,
    financialTotal,
    thresholdUsed,
    excessFinancial,
    grossUpAmount,
    incomeDeductions: otherIncomeDeduction,
    bases: {
      comprehensiveBeforeDeductions: comprehensiveTaxableBaseBeforeDeductions,
      comprehensiveAfterDeductions: comprehensiveTaxableBase,
      otherBeforeDeductions: otherTaxableBaseBeforeDeductions,
      otherAfterDeductions: otherTaxableBaseAfterDeductions,
    },
    progressive: {
      comprehensive: progressiveComprehensive,
      otherOnly: progressiveOtherOnly,
    },
    taxes: {
      methodATax,
      methodBTax,
      chosenTaxBeforeCredits,
      dividendCredit,
      foreignTaxCredit,
      otherTaxCredit,
      nationalTax,
      localIncomeTax,
      separateOtherTax,
      totalPayable,
    },
    prepaid: {
      prepaidNational,
      prepaidLocal,
      prepaidWithholding,
      prepaidOther: otherIncomeResult.prepaid,
    },
    rental: {
      separateUsed: otherIncomeResult.rentalSeparateUsed,
      separateExcess: otherIncomeResult.rentalSeparateExcess,
      threshold: rules.rentalSeparateThreshold,
    },
    trace,
    warnings,
  };

  return result;
}
