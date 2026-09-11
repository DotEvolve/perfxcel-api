import { Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { NotFoundError, AppError, ErrorCategory } from '@dotevolve/error-utils';

export const getCourses = async (req: Request, res: Response) => {
  const { category_id, city_id, association_id } = req.query;

  let query = supabase.from('courses').select('*, categories(*), cities(*), associations(*)');

  if (category_id) query = query.eq('category_id', category_id);
  if (city_id) query = query.eq('city_id', city_id);
  if (association_id) query = query.eq('association_id', association_id);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  res.status(200).json({
    status: 'success',
    results: data.length,
    data,
  });
};

export const getCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('courses')
    .select('*, categories(*), cities(*), associations(*)')
    .eq('id', id)
    .single();

  if (error) {
    throw new AppError(error.message, 500, ErrorCategory.SYSTEM);
  }

  if (!data) {
    throw new NotFoundError('Course not found');
  }

  res.status(200).json({
    status: 'success',
    data,
  });
};

export const createCourse = async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('courses')
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

export const updateCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('courses')
    .update(req.body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  if (!data) {
    throw new NotFoundError('Course not found');
  }

  res.status(200).json({
    status: 'success',
    data,
  });
};

export const deleteCourse = async (req: Request, res: Response) => {
  const { id } = req.params;

  const { error } = await supabase.from('courses').delete().eq('id', id);

  if (error) {
    throw new AppError(error.message, 400, ErrorCategory.VALIDATION);
  }

  res.status(204).send();
};
