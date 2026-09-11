import { Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { AppError, ErrorCategory } from '@dotevolve/error-utils';

export const getTaxonomies = async (req: Request, res: Response) => {
  const [categoriesRes, citiesRes, associationsRes] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    supabase.from('cities').select('*').order('name'),
    supabase.from('associations').select('*').order('name'),
  ]);

  if (categoriesRes.error) throw new AppError(categoriesRes.error.message, 500, ErrorCategory.SYSTEM);
  if (citiesRes.error) throw new AppError(citiesRes.error.message, 500, ErrorCategory.SYSTEM);
  if (associationsRes.error) throw new AppError(associationsRes.error.message, 500, ErrorCategory.SYSTEM);

  res.status(200).json({
    status: 'success',
    data: {
      categories: categoriesRes.data,
      cities: citiesRes.data,
      associations: associationsRes.data,
    },
  });
};

export const createTaxonomyItem = async (req: Request, res: Response) => {
  const { type } = req.params; // 'categories', 'cities', 'associations'
  
  if (!['categories', 'cities', 'associations'].includes(type as string)) {
    throw new AppError('Invalid taxonomy type', 400, ErrorCategory.VALIDATION);
  }

  const { data, error } = await supabase
    .from(type as any)
    .insert([req.body])
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(201).json({
    status: 'success',
    data,
  });
};

export const updateTaxonomyItem = async (req: Request, res: Response) => {
  const { type, id } = req.params;

  if (!['categories', 'cities', 'associations'].includes(type as string)) {
    throw new AppError('Invalid taxonomy type', 400, ErrorCategory.VALIDATION);
  }

  const { data, error } = await supabase
    .from(type as any)
    .update(req.body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(200).json({
    status: 'success',
    data,
  });
};

export const deleteTaxonomyItem = async (req: Request, res: Response) => {
  const { type, id } = req.params;

  if (!['categories', 'cities', 'associations'].includes(type as string)) {
    throw new AppError('Invalid taxonomy type', 400, ErrorCategory.VALIDATION);
  }

  const { error } = await supabase.from(type as any).delete().eq('id', id);

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(204).send();
};
